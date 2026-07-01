<script setup lang="ts">
import { Line } from 'vue-chartjs'

defineProps<{ data: any; options?: any }>()
</script>

<template>
  <Line :data="data" :options="options ?? {}" />
</template>
