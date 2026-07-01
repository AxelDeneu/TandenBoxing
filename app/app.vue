<script setup lang="ts">
const { appName } = useRuntimeConfig().public

useHead({
  titleTemplate: (title) => (title ? `${title} · ${appName}` : appName),
})
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
