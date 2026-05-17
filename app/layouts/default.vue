<script setup lang="ts">
import type { ApiSuccessResponse, AuthSessionState } from '../../shared/types'

const navigationItems = [
  { label: 'Dashboard', to: '/' },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Rewards', to: '/rewards' },
  { label: 'Settings', to: '/settings' }
]

const defaultSessionState: AuthSessionState = {
  authenticated: false,
  user: null,
  initialSyncCompleted: false
}

const { data: sessionResponse, pending: sessionPending, refresh: refreshSession } = useFetch<ApiSuccessResponse<AuthSessionState>>('/api/auth/session', {
  key: 'auth-session'
})

const sessionState = computed(() => sessionResponse.value?.data ?? defaultSessionState)
const isAuthenticated = computed(() => sessionState.value.authenticated)

const route = useRoute()
const isActive = (path: string) => route.path === path
async function logout() {
  await $fetch('/api/auth/logout', {
    method: 'POST'
  })

  await refreshSession()
}
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_35%),linear-gradient(180deg,_#f4f1e8_0%,_#fffdf8_48%,_#f5f8ef_100%)] text-highlighted dark:bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.14),_transparent_38%),linear-gradient(180deg,_#0c1210_0%,_#0f1714_48%,_#0a100e_100%)]">
    <UHeader
      toggle-side="right"
      class="border-b border-default/60 bg-background/80 backdrop-blur"
    >
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-3"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-inverted shadow-sm ring-1 ring-primary/20">
            <UIcon
              name="i-lucide-list-todo"
              class="size-5"
            />
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
        <div class="hidden items-center gap-3 lg:flex">
          <div class="flex items-center gap-3 rounded-2xl border border-default/70 bg-background/75 px-3 py-2 text-sm shadow-sm">
            <template v-if="sessionPending">
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin text-primary"
              />
              <span class="text-toned">Checking session</span>
            </template>
            <template v-else-if="isAuthenticated && sessionState.user">
              <UAvatar
                :alt="sessionState.user.displayName ?? sessionState.user.email"
                :text="(sessionState.user.displayName ?? sessionState.user.email).slice(0, 1).toUpperCase()"
                size="sm"
              />
              <div class="leading-tight">
                <p class="font-medium text-highlighted">
                  {{ sessionState.user.displayName ?? sessionState.user.email }}
                </p>
                <p class="text-xs text-toned">
                  App session active
                </p>
              </div>
            </template>
            <template v-else>
              <UIcon
                name="i-lucide-shield-off"
                class="size-4 text-toned"
              />
              <div class="leading-tight">
                <p class="font-medium text-highlighted">
                  No active session
                </p>
                <p class="text-xs text-toned">
                  Todoist OAuth lands next
                </p>
              </div>
            </template>
          </div>

          <UButton
            v-if="isAuthenticated"
            color="neutral"
            variant="outline"
            class="font-medium"
            @click="logout"
          >
            Logout
          </UButton>
          <UButton
            v-else
            color="primary"
            variant="soft"
            class="font-medium"
            href="/api/auth/todoist/start"
            external
          >
            Connect Todoist
          </UButton>

          <nav class="flex items-center gap-2">
            <UButton
              v-for="item in navigationItems"
              :key="item.to"
              :to="item.to"
              :color="isActive(item.to) ? 'primary' : 'neutral'"
              :variant="isActive(item.to) ? 'soft' : 'ghost'"
              :class="['font-medium', isActive(item.to) ? 'rounded-lg ring-2 ring-primary/30 shadow-sm' : '']"
            >
              {{ item.label }}
            </UButton>
          </nav>
        </div>

        <nav class="hidden items-center gap-2 lg:hidden">
          <UButton
            v-for="item in navigationItems"
            :key="item.to"
            :to="item.to"
            :color="isActive(item.to) ? 'primary' : 'neutral'"
            :variant="isActive(item.to) ? 'soft' : 'ghost'"
            :class="['font-medium', isActive(item.to) ? 'rounded-lg ring-2 ring-primary/30 shadow-sm' : '']"
          >
            {{ item.label }}
          </UButton>
        </nav>
        <UColorModeButton />
      </template>

      <template #body>
        <div class="space-y-3 px-2 py-3 lg:hidden">
          <div class="rounded-2xl border border-default/70 bg-background/75 px-3 py-3 text-sm shadow-sm">
            <template v-if="sessionPending">
              <div class="flex items-center gap-2 text-toned">
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-4 animate-spin text-primary"
                />
                <span>Checking session</span>
              </div>
            </template>
            <template v-else-if="isAuthenticated && sessionState.user">
              <p class="font-medium text-highlighted">
                {{ sessionState.user.displayName ?? sessionState.user.email }}
              </p>
              <p class="mt-1 text-xs text-toned">
                App session active
              </p>
            </template>
            <template v-else>
              <p class="font-medium text-highlighted">
                No active session
              </p>
              <p class="mt-1 text-xs text-toned">
                Connect Todoist becomes available with OAuth.
              </p>
            </template>

            <UButton
              v-if="isAuthenticated"
              color="neutral"
              variant="outline"
              size="sm"
              class="mt-3"
              @click="logout"
            >
              Logout
            </UButton>
            <UButton
              v-else
              color="primary"
              variant="soft"
              size="sm"
              class="mt-3"
              href="/api/auth/todoist/start"
              external
            >
              Connect Todoist
            </UButton>
          </div>

          <nav class="flex flex-col gap-2">
            <UButton
              v-for="item in navigationItems"
              :key="`${item.to}-mobile`"
              :to="item.to"
              :color="isActive(item.to) ? 'primary' : 'neutral'"
              :variant="isActive(item.to) ? 'soft' : 'ghost'"
              block
              :class="['justify-start', isActive(item.to) ? 'rounded-lg ring-2 ring-primary/30 shadow-sm' : '']"
            >
              {{ item.label }}
            </UButton>
          </nav>
        </div>
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-10 sm:py-12">
        <slot />
      </UContainer>
    </UMain>
  </div>
</template>
