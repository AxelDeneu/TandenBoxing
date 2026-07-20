<script setup lang="ts">
import { Radar } from 'vue-chartjs'

defineProps<{ data: any; options?: any }>()
</script>

<template>
  <Radar :data="data" :options="options ?? {}" />
</template>
