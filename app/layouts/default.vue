<template>
  <!-- Mobile : colonne unique + BottomNav. Desktop (≥ lg) : SideNav + contenu élargi. -->
  <div class="flex min-h-dvh w-full flex-col lg:flex-row">
    <SideNav />
    <main class="flex-1 pb-24 lg:pb-0">
      <div class="mx-auto w-full max-w-lg lg:max-w-6xl lg:px-8">
        <slot />
      </div>
    </main>
    <BottomNav />
    <GlossaryDrawer />
  </div>
</template>
