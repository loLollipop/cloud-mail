import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import {verifyRecordType} from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import verifyRecordService from './verify-record-service';
import userContext from '../security/user-context';
import verifyUtils from '../utils/verify-utils';

const settingService = {

	async refresh(c) {
		let settingRow;
		try {
			settingRow = await orm(c).select().from(setting).get();
		} catch (e) {
			if (!['domain_list', 'disabled_domain_list'].some(column => e.message?.includes(column))) throw e;
			await this.ensureDomainColumn(c);
			settingRow = await orm(c).select().from(setting).get();
		}
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		this.applyDomainState(c, settingRow);
		c.set('setting', settingRow);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {

		if (c.get?.('setting')) {
			return c.get('setting')
		}

		const setting = await c.env.kv.get(KvConst.SETTING, { type: 'json' });

		if (!setting) {
			throw new BizError('数据库未初始化 Database not initialized.');
		}

		const { domainList, disabledDomainList, enabledDomainList } = this.resolveDomainState(c, setting);
		if (domainList.length === 0) {
			throw new BizError(t('noDomainVariable'));
		}

		setting.domainList = domainList;
		setting.disabledDomainList = disabledDomainList;
		setting.enabledDomainList = enabledDomainList;


		let linuxdoSwitch = c.env.linuxdo_switch;
		let projectLink = c.env.project_link;

		if (typeof linuxdoSwitch === 'string' && linuxdoSwitch === 'true') {
			linuxdoSwitch = true
		} else if (linuxdoSwitch === true) {
			linuxdoSwitch = true
		} else {
			linuxdoSwitch = false
		}

		if (typeof projectLink === 'string' && projectLink === 'false') {
			projectLink = false
		} else if (projectLink === false) {
			projectLink = false
		} else {
			projectLink = true
		}

		setting.projectLink = projectLink;

		setting.linuxdoClientId = c.env.linuxdo_client_id;
		setting.linuxdoCallbackUrl = c.env.linuxdo_callback_url;
		setting.linuxdoSwitch = linuxdoSwitch;

		setting.emailPrefixFilter = setting.emailPrefixFilter.split(",").filter(Boolean);

		c.set?.('setting', setting);
		return setting;
	},

	async get(c, showSiteKey = false) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);


		if (!showSiteKey) {
			settingRow.siteKey = settingRow.siteKey ? `${settingRow.siteKey.slice(0, 6)}******` : null;
		}

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 6)}******` : null;

		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.s3AccessKey = settingRow.s3AccessKey ? `${settingRow.s3AccessKey.slice(0, 12)}******` : null;
		settingRow.s3SecretKey = settingRow.s3SecretKey ? `${settingRow.s3SecretKey.slice(0, 12)}******` : null;
		settingRow.tgBotToken = settingRow.tgBotToken ? `${settingRow.tgBotToken.slice(0, 20)}******` : null;
		settingRow.hasR2 = !!c.env.r2
		settingRow.hasCfEmail = !!c.env.email

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		settingRow.storageType = await r2Service.storageType(c);

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});

		if (Array.isArray(params.emailPrefixFilter)) {
			params.emailPrefixFilter = params.emailPrefixFilter + '';
		}

		if (Array.isArray(params.aiCodeFilter)) {
			params.aiCodeFilter = params.aiCodeFilter + '';
		}

		if (Object.prototype.hasOwnProperty.call(params, 'loginBackgroundSize')) {
			params.loginBackgroundSize = Math.min(100, Math.max(30, Number(params.loginBackgroundSize) || 100));
		}

		delete params.domainList;
		delete params.disabledDomainList;
		delete params.enabledDomainList;
		delete params.hasR2;
		delete params.hasCfEmail;
		delete params.storageType;

		params.resendTokens = JSON.stringify(resendTokens);
		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async setDomains(c, params = {}) {
		await this.ensureDomainColumn(c);
		const domainList = this.normalizeDomainList(params.domainList);
		if (domainList.length === 0) {
			throw new BizError(t('noDomainVariable'));
		}
		const disabledDomainList = this.normalizeDisabledDomainList(params.disabledDomainList, domainList);

		await orm(c).update(setting).set({
			domainList: domainList.join(','),
			disabledDomainList: disabledDomainList.join(',')
		}).run();
		await this.refresh(c);
		return this.get(c);
	},

	async addDomain(c, params) {
		const settingData = await this.query(c);
		const domain = this.normalizeDomain(params.domain);
		const domainList = [...settingData.domainList.map(item => item.replace(/^@/, '')), domain];
		return this.setDomains(c, { domainList, disabledDomainList: settingData.disabledDomainList });
	},

	async deleteDomain(c, params) {
		const domain = this.normalizeDomain(params.domain);
		const settingData = await this.query(c);
		const domainList = settingData.domainList
			.map(item => item.replace(/^@/, ''))
			.filter(item => item !== domain);
		const disabledDomainList = settingData.disabledDomainList
			.map(item => item.replace(/^@/, ''))
			.filter(item => item !== domain);
		return this.setDomains(c, { domainList, disabledDomainList });
	},

	async syncCloudflareDomain(c, params = {}) {
		if (!this.getCloudflareApiToken(c)) {
			throw new BizError('CF_API_TOKEN is not configured');
		}

		if (!this.getCloudflareAccountId(c)) {
			throw new BizError('CLOUDFLARE_ACCOUNT_ID is not configured');
		}

		const settingData = await this.query(c);
		const domainList = params.domainList
			? this.normalizeDomainList(params.domainList)
			: this.normalizeDomainList(settingData.domainList);
		if (domainList.length === 0) {
			throw new BizError(t('noDomainVariable'));
		}
		const disabledDomainList = Object.prototype.hasOwnProperty.call(params, 'disabledDomainList')
			? this.normalizeDisabledDomainList(params.disabledDomainList, domainList)
			: this.normalizeDisabledDomainList(settingData.disabledDomainList, domainList);

		await orm(c).update(setting).set({
			domainList: domainList.join(','),
			disabledDomainList: disabledDomainList.join(',')
		}).run();
		await this.refresh(c);
		const syncResult = await this.syncWorkerDomainVariable(c, domainList);
		const updatedSettingData = await this.get(c);
		updatedSettingData.cloudflareSync = syncResult;

		return updatedSettingData;
	},

	async syncWorkerDomainVariable(c, domainList) {
		const accountId = this.getCloudflareAccountId(c);
		const workerName = this.getCloudflareWorkerName(c);
		const settingsPath = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`;
		const settingsData = await this.cloudflareRequest(c, settingsPath, { method: 'GET' });
		const bindings = settingsData?.result?.bindings || [];
		const inheritBindings = bindings
			.filter(item => item.name !== 'domain')
			.map(item => ({ type: item.type, name: item.name }));

		const formData = new FormData();
		formData.set('settings', JSON.stringify({
			bindings: [
				...inheritBindings,
				{
					type: 'plain_text',
					name: 'domain',
					text: JSON.stringify(domainList)
				}
			]
		}));

		await this.cloudflareRequest(c, settingsPath, {
			method: 'PATCH',
			body: formData
		});

		return {
			workerName,
			variableName: 'domain'
		};
	},

	async cloudflareRequest(c, path, init = {}) {
		const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
		const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.getCloudflareApiToken(c)}`,
				...(isFormData ? {} : { 'Content-Type': 'application/json' }),
				...(init.headers || {})
			}
		});
		const data = await resp.json();
		if (!resp.ok || data.success === false) {
			const message = data.errors?.map(item => item.message).join('; ') || `Cloudflare API failed: ${resp.status}`;
			throw new BizError(message);
		}
		return data;
	},

	getCloudflareApiToken(c) {
		return c.env.cf_api_token || c.env.CF_API_TOKEN || c.env.CLOUDFLARE_API_TOKEN;
	},

	getCloudflareAccountId(c) {
		return c.env.cloudflare_account_id || c.env.CLOUDFLARE_ACCOUNT_ID;
	},

	getCloudflareWorkerName(c, workerName) {
		return workerName || c.env.cf_worker_name || c.env.CF_WORKER_NAME || 'lollipop-mail';
	},

	async ensureDomainColumn(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN domain_list TEXT NOT NULL DEFAULT '';`).run();
		} catch (e) {
			if (!e.message?.includes('duplicate column')) {
				console.warn(`跳过域名字段：${e.message}`);
			}
		}
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN disabled_domain_list TEXT NOT NULL DEFAULT '';`).run();
		} catch (e) {
			if (!e.message?.includes('duplicate column')) {
				console.warn(`Skip disabled domain column: ${e.message}`);
			}
		}
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN login_background_size INTEGER NOT NULL DEFAULT 100;`).run();
		} catch (e) {
			if (!e.message?.includes('duplicate column')) {
				console.warn(`Skip login background size column: ${e.message}`);
			}
		}
	},

	applyDomainState(c, settingRow = {}) {
		const { domainList, disabledDomainList, enabledDomainList } = this.resolveDomainState(c, settingRow);
		settingRow.domainList = domainList;
		settingRow.disabledDomainList = disabledDomainList;
		settingRow.enabledDomainList = enabledDomainList;
		return settingRow;
	},

	resolveDomainState(c, settingRow = {}) {
		const domainList = this.resolveDomainList(c, settingRow);
		const domainSet = new Set(domainList.map(item => item.replace(/^@/, '')));
		const disabledDomainList = this.normalizeDomainList(settingRow.disabledDomainList, false)
			.filter(item => domainSet.has(item))
			.map(item => '@' + item);
		const disabledSet = new Set(disabledDomainList);
		const enabledDomainList = domainList.filter(item => !disabledSet.has(item));

		return { domainList, disabledDomainList, enabledDomainList };
	},

	resolveDomainList(c, settingRow = {}) {
		const savedList = this.normalizeDomainList(settingRow.domainList, false);
		if (savedList.length > 0) {
			return savedList.map(item => '@' + item);
		}

		const envList = this.parseEnvDomain(c.env.domain);
		return envList.map(item => '@' + item);
	},

	parseEnvDomain(domain) {
		if (!domain) {
			return [];
		}

		if (Array.isArray(domain)) {
			return this.normalizeDomainList(domain, false);
		}

		if (typeof domain === 'string') {
			const value = domain.trim();
			if (!value) return [];

			if (value.startsWith('[')) {
				try {
					return this.normalizeDomainList(JSON.parse(value), false);
				} catch (error) {
					throw new BizError(t('notJsonDomain'));
				}
			}

			return this.normalizeDomainList(value, false);
		}

		return [];
	},

	normalizeDomainList(domainList, throwOnInvalid = true) {
		if (!domainList) {
			return [];
		}

		const list = Array.isArray(domainList)
			? domainList
			: `${domainList}`.split(/[,，\s]+/);

		const normalizedList = [];
		for (const item of list) {
			if (!item) continue;
			const domain = this.normalizeDomain(item, throwOnInvalid);
			if (domain && !normalizedList.includes(domain)) {
				normalizedList.push(domain);
			}
		}
		return normalizedList;
	},

	normalizeDisabledDomainList(disabledDomainList, domainList) {
		const domainSet = new Set(domainList);
		return this.normalizeDomainList(disabledDomainList, false)
			.filter(item => domainSet.has(item));
	},

	normalizeDomain(domain, throwOnInvalid = true) {
		const value = `${domain || ''}`
			.trim()
			.toLowerCase()
			.replace(/^@/, '')
			.replace(/^https?:\/\//, '')
			.replace(/\/.*$/, '');

		if (!value) {
			if (throwOnInvalid) throw new BizError(t('notEmailDomain'));
			return '';
		}

		if (!verifyUtils.isDomain(value)) {
			if (throwOnInvalid) throw new BizError(t('notEmailDomain'));
			return '';
		}

		return value;
	},

	hasDomain(c, domain) {
		const domainList = this.resolveDomainList(c, c.get?.('setting') || {});
		return domainList.includes('@' + this.normalizeDomain(domain, false));
	},

	async deleteBackground(c) {

		const { background } = await this.query(c);
		if (!background) return

		if (background.startsWith('http')) {
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
			return;
		}

		if (background) {
			await r2Service.delete(c,background)
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
		}
	},

	async setBackground(c, params) {

		let { background } = params

		await this.deleteBackground(c);

		if (background && !background.startsWith('http')) {

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type,
				cacheControl: `public, max-age=31536000, immutable`,
				contentDisposition: `inline; filename="${file.name}"`
			});

		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},


	async setBlacklist(c, params) {
		const { blackSubject, blackContent, blackFrom  } = params
		await orm(c).update(setting).set({ blackSubject, blackContent, blackFrom }).run();
		await this.refresh(c);
		return this.get(c);
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c, true);
		const token = await userContext.getToken(c);

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefresh: settingRow.autoRefresh,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			loginOpacity: settingRow.loginOpacity,
			loginBackgroundSize: settingRow.loginBackgroundSize || 100,
			domainList: settingRow.loginDomain === 1 && !token ? [] : settingRow.enabledDomainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain,
			linuxdoClientId: settingRow.linuxdoClientId,
			linuxdoCallbackUrl: settingRow.linuxdoCallbackUrl,
			linuxdoSwitch: settingRow.linuxdoSwitch,
			minEmailPrefix: settingRow.minEmailPrefix,
			projectLink: settingRow.projectLink
		};
	},

};

export default settingService;
