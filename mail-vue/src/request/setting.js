import http from '@/axios/index.js';

export function settingSet(setting) {
    return http.put('/setting/set', setting)
}

export function settingQuery() {
    return http.get('/setting/query')
}

export function websiteConfig() {
    return http.get('/setting/websiteConfig')
}

export function setBackground(background) {
    return http.put('/setting/setBackground',{background})
}

export function deleteBackground() {
    return http.delete('/setting/deleteBackground')
}

export function setBlackList(params) {
    return http.put('/setting/setBlacklist', params)
}

export function setDomains(domainList, disabledDomainList = []) {
    return http.put('/setting/domains', { domainList, disabledDomainList })
}

export function addDomain(domain) {
    return http.post('/setting/domains', { domain })
}

export function deleteDomain(domain) {
    return http.delete(`/setting/domains/${encodeURIComponent(domain)}`)
}

export function syncCloudflareDomain(domainList, disabledDomainList = []) {
    return http.post('/setting/domains/sync-cloudflare', { domainList, disabledDomainList })
}
