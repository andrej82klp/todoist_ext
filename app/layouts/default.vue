<script setup lang="ts">
const navigationItems = [
  { label: 'Dashboard', to: '/' },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Rewards', to: '/rewards' },
  { label: 'Settings', to: '/settings' }
]
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_35%),linear-gradient(180deg,_#f4f1e8_0%,_#fffdf8_48%,_#f5f8ef_100%)] text-highlighted">
    <UHeader toggle-side="right" class="border-b border-default/60 bg-background/80 backdrop-blur">
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-inverted shadow-sm ring-1 ring-primary/20">
            <UIcon name="i-lucide-list-todo" class="size-5" />
          </div>
          <div>
            <p class="text-sm font-semibold tracking-[0.18em] uppercase text-toned">
              Todoist Companion
            </p>
            <p class="text-base font-semibold text-highlighted">
              Gamification MVP
            </p>
          </div>
        </NuxtLink>
      </template>

      <template #right>
        <nav class="hidden items-center gap-2 lg:flex">
          <UButton
            v-for="item in navigationItems"
            :key="item.to"
            :to="item.to"
            color="neutral"
            variant="ghost"
            class="font-medium"
          >
            {{ item.label }}
          </UButton>
        </nav>
        <UColorModeButton />
      </template>

      <template #body>
        <nav class="flex flex-col gap-2 px-2 py-3 lg:hidden">
          <UButton
            v-for="item in navigationItems"
            :key="`${item.to}-mobile`"
            :to="item.to"
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
          >
            {{ item.label }}
          </UButton>
        </nav>
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-10 sm:py-12">
        <slot />
      </UContainer>
    </UMain>
  </div>
</template>
