<template>
  <!-- Mobile : colonne unique + BottomNav. Desktop (≥ lg) : SideNav + contenu élargi. -->
  <div class="flex min-h-dvh w-full flex-col lg:flex-row">
    <a
      href="#main-content"
      class="sr-only fixed left-3 top-3 z-50 rounded-lg bg-default px-4 py-2 font-medium focus:not-sr-only focus:outline-2 focus:outline-primary"
    >
      Aller au contenu principal
    </a>
    <SideNav />
    <main id="main-content" tabindex="-1" class="flex-1 pb-24 lg:pb-0">
      <div class="mx-auto w-full max-w-lg lg:max-w-6xl lg:px-8">
        <slot />
      </div>
    </main>
    <BottomNav />
    <GlossaryDrawer />
  </div>
</template>
