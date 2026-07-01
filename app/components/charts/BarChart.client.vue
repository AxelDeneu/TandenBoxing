<script setup lang="ts">
import { Bar } from 'vue-chartjs'

defineProps<{ data: any; options?: any }>()
</script>

<template>
  <Bar :data="data" :options="options ?? {}" />
</template>
