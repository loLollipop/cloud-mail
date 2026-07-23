<template>
  <el-dropdown
      trigger="click"
      class="domain-select-dropdown"
      popper-class="domain-select-popper"
      @command="selectDomain"
  >
    <div class="domain-select-trigger">
      <span class="domain-select-text">{{ modelValue || placeholder }}</span>
      <Icon class="domain-select-icon" icon="mingcute:down-small-fill" width="20" height="20"/>
    </div>
    <template #dropdown>
      <el-dropdown-menu class="domain-select-menu">
        <el-dropdown-item
            v-for="item in domainList"
            :key="item"
            :command="item"
        >
          {{ item }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import {Icon} from "@iconify/vue";

defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  domainList: {
    type: Array,
    default: () => []
  },
  placeholder: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue'])

function selectDomain(value) {
  emit('update:modelValue', value)
}
</script>

<style scoped>
.domain-select-dropdown {
  max-width: min(170px, 42vw);
}

.domain-select-trigger {
  display: flex;
  align-items: center;
  height: 36px;
  max-width: min(170px, 42vw);
  color: var(--el-text-color-primary);
  cursor: pointer;
  user-select: none;
}

.domain-select-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.domain-select-icon {
  flex: none;
  margin-left: 4px;
}

:global(.domain-select-popper .domain-select-menu) {
  max-height: min(320px, calc(100vh - 48px));
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
