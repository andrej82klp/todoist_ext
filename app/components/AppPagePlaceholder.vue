<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="space-y-8">
    <section class="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:items-start">
      <UCard class="border-default/70 bg-background/80 shadow-sm">
        <template #header>
          <div class="space-y-3">
            <p class="text-xs font-semibold tracking-[0.2em] uppercase text-primary">
              {{ eyebrow }}
            </p>
            <div class="space-y-2">
              <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
                {{ title }}
              </h1>
              <p class="max-w-2xl text-base leading-7 text-toned">
                {{ description }}
              </p>
            </div>
          </div>
        </template>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div class="rounded-2xl border border-dashed border-primary/35 bg-primary/5 p-4">
            <p class="text-sm font-semibold text-highlighted">
              Milestone 1
            </p>
            <p class="mt-2 text-sm leading-6 text-toned">
              Route scaffold is live and ready for feature-specific components.
            </p>
          </div>
          <div class="rounded-2xl border border-dashed border-default p-4">
            <p class="text-sm font-semibold text-highlighted">
              API integration pending
            </p>
            <p class="mt-2 text-sm leading-6 text-toned">
              This page will switch to live data once the corresponding Nitro endpoints land.
            </p>
          </div>
          <div class="rounded-2xl border border-dashed border-default p-4">
            <p class="text-sm font-semibold text-highlighted">
              App-owned data only
            </p>
            <p class="mt-2 text-sm leading-6 text-toned">
              Todoist stays the source of truth while this app layers scoring, rewards, and streak state on top.
            </p>
          </div>
        </div>
      </UCard>

      <UCard class="border-default/70 bg-background/80 shadow-sm">
        <template #header>
          <div class="flex items-center gap-3">
            <div class="rounded-xl bg-secondary/70 p-2 text-highlighted ring-1 ring-default/80">
              <UIcon name="i-lucide-flag" class="size-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-highlighted">
                Next implementation target
              </p>
              <p class="text-sm text-toned">
                Session, auth, and initial Todoist sync foundations.
              </p>
            </div>
          </div>
        </template>

        <ul class="space-y-3 text-sm leading-6 text-toned">
          <li>Wire the first server endpoints and shared response contracts.</li>
          <li>Add environment-backed runtime configuration.</li>
          <li>Replace placeholder cards with live dashboard, task, reward, and settings state.</li>
        </ul>
      </UCard>
    </section>
  </div>
</template>
