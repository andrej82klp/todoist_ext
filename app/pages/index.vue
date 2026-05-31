<script setup lang="ts">
import type {
  AnalyticsSummary,
  ApiSuccessResponse,
  DashboardNotification,
  DashboardSummary,
  DashboardTaskSummary,
  LedgerTransaction,
  PointsSummary,
  StreakSummary
} from '#shared/types'

const acknowledgingId = ref<string | null>(null)
const acknowledgeError = ref('')

const { data: dashboardEnvelope, pending, error, refresh } = await useFetch<ApiSuccessResponse<DashboardSummary>>('/api/dashboard', {
  credentials: 'include'
})

const dashboard = computed(() => dashboardEnvelope.value?.data ?? null)
const points = computed<PointsSummary | null>(() => dashboard.value?.points ?? null)
const streak = computed<StreakSummary | null>(() => dashboard.value?.streak ?? null)
const todayTasks = computed<DashboardTaskSummary[]>(() => dashboard.value?.todayTasks ?? [])
const recentTransactions = computed<LedgerTransaction[]>(() => dashboard.value?.recentTransactions ?? [])
const rewardProgress = computed(() => dashboard.value?.rewardProgress ?? { closestReward: null })
const notifications = computed<DashboardNotification[]>(() => dashboard.value?.notifications ?? [])

const dashboardErrorCode = computed(() => {
  const candidate = error.value as { data?: { error?: { code?: string } } } | null
  return candidate?.data?.error?.code ?? null
})

const streakProgressPercent = computed(() => {
  const streakValue = streak.value

  if (!streakValue?.nextMilestone) {
    return 100
  }

  if (streakValue.nextMilestone.days <= 0) {
    return 0
  }

  return Math.min(100, Math.round((streakValue.current / streakValue.nextMilestone.days) * 100))
})

function transactionTone(type: LedgerTransaction['type']) {
  switch (type) {
    case 'earned':
      return 'success'
    case 'bonus':
      return 'primary'
    case 'spent':
      return 'warning'
    case 'adjusted':
      return 'neutral'
  }
}

function badgeTone(_badge: string | null): 'primary' {
  return 'primary'
}

function notificationTone(severity: DashboardNotification['severity']) {
  switch (severity) {
    case 'critical':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
      return 'primary'
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

async function acknowledgeNotification(notificationId: string) {
  if (acknowledgingId.value) {
    return
  }

  acknowledgeError.value = ''
  acknowledgingId.value = notificationId

  try {
    await $fetch(`/api/dashboard/notifications/${notificationId}/acknowledge`, {
      method: 'POST',
      credentials: 'include'
    })

    await refresh()
  } catch (fetchError: unknown) {
    const candidate = fetchError as { data?: { error?: { message?: string } } }
    acknowledgeError.value = candidate.data?.error?.message ?? 'Could not acknowledge notification'
  } finally {
    acknowledgingId.value = null
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

const {
  data: analyticsEnvelope,
  pending: analyticsPending,
  error: analyticsFetchError,
  refresh: refreshAnalytics
} = await useFetch<ApiSuccessResponse<AnalyticsSummary>>('/api/analytics/summary', {
  credentials: 'include'
})

const analytics = computed<AnalyticsSummary | null>(() => analyticsEnvelope.value?.data ?? null)
const mostRewardingProjects = computed(() => analytics.value?.mostRewardingProjects ?? [])
const analyticsStreak = computed(() => analytics.value?.streakHistory ?? { current: 0, longest: 0, milestonesReached: [] })
</script>

<template>
  <div class="space-y-8">
    <section class="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <UCard class="overflow-hidden border-default/70 bg-background/80 shadow-sm">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-3">
            <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Motivation-first home
            </p>
            <div class="space-y-2">
              <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
                Dashboard
              </h1>
              <p class="max-w-2xl text-base leading-7 text-toned">
                Keep the whole loop in view: points, streak momentum, today’s best work, and the next reward within reach.
              </p>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
            <div class="rounded-2xl border border-primary/20 bg-primary/8 px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Current balance
              </p>
              <p class="mt-2 text-3xl font-bold text-primary">
                {{ points?.currentBalance ?? 0 }}
              </p>
            </div>
            <div class="rounded-2xl border border-default/60 bg-background/70 px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Lifetime earned
              </p>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ points?.lifetimeEarned ?? 0 }}
              </p>
            </div>
            <div class="rounded-2xl border border-default/60 bg-background/70 px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Lifetime spent
              </p>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ points?.lifetimeSpent ?? 0 }}
              </p>
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <UButton
            to="/tasks"
            icon="i-lucide-list-checks"
          >
            Review today’s work
          </UButton>
          <UButton
            to="/rewards"
            color="neutral"
            variant="outline"
            icon="i-lucide-gift"
          >
            Open reward shop
          </UButton>
          <UButton
            to="/settings"
            color="neutral"
            variant="ghost"
            icon="i-lucide-sliders-horizontal"
          >
            Tune scoring rules
          </UButton>
        </div>
      </UCard>

      <UCard class="border-default/70 bg-background/80 shadow-sm">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-highlighted">
                Streak status
              </p>
              <p class="text-sm text-toned">
                Progress toward the next streak milestone.
              </p>
            </div>
            <UBadge
              color="primary"
              variant="subtle"
            >
              {{ streak?.ruleType === 'points' ? 'Points rule' : 'Completion rule' }}
            </UBadge>
          </div>
        </template>

        <div class="space-y-5">
          <div class="grid gap-4 sm:grid-cols-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Current streak
              </p>
              <p class="mt-1 text-3xl font-bold text-primary">
                {{ streak?.current ?? 0 }}
              </p>
            </div>
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Longest streak
              </p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">
                {{ streak?.longest ?? 0 }}
              </p>
            </div>
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-toned">
                Protection balance
              </p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">
                {{ streak?.protectionBalance ?? 0 }}
              </p>
            </div>
          </div>

          <div class="rounded-2xl border border-default/60 bg-muted/20 p-4">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="font-medium text-highlighted">
                Next milestone
              </span>
              <span class="text-toned">
                <template v-if="streak?.nextMilestone">
                  {{ streak.nextMilestone.days }} days · {{ streak.nextMilestone.remainingDays }} to go
                </template>
                <template v-else>
                  No active milestone ahead
                </template>
              </span>
            </div>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all"
                :style="{ width: `${streakProgressPercent}%` }"
              />
            </div>
            <p class="mt-3 text-sm text-toned">
              Rule target: {{ streak?.ruleValue ?? 0 }} {{ streak?.ruleType === 'points' ? 'points per day' : 'completed item per day' }}
            </p>
          </div>
        </div>
      </UCard>
    </section>

    <div
      v-if="pending"
      class="grid gap-6 lg:grid-cols-3"
    >
      <USkeleton class="h-80 rounded-2xl" />
      <USkeleton class="h-80 rounded-2xl" />
      <USkeleton class="h-80 rounded-2xl" />
    </div>

    <div
      v-else-if="error"
      class="space-y-4"
    >
      <UAlert
        v-if="dashboardErrorCode === 'UNAUTHORIZED'"
        color="warning"
        variant="subtle"
        title="Dashboard requires an active Todoist session"
        description="Connect Todoist from the header to load your synced dashboard data."
      />
      <UAlert
        v-else
        color="error"
        variant="subtle"
        title="Could not load dashboard"
        :description="error.message"
      />

      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        @click="() => refresh()"
      >
        Retry
      </UButton>
    </div>

    <template v-else>
      <section class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(300px,0.9fr)]">
        <UCard class="border-default/70 bg-background/80 shadow-sm xl:col-span-2">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold text-highlighted">
                  Today’s tasks
                </h2>
                <p class="text-sm text-toned">
                  Due today or already overdue, ordered by urgency and reward potential.
                </p>
              </div>
              <UButton
                to="/tasks"
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-right"
                trailing
              >
                Open tasks
              </UButton>
            </div>
          </template>

          <div
            v-if="todayTasks.length === 0"
            class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-6 py-10 text-center"
          >
            <p class="text-lg font-medium text-highlighted">
              Nothing due today
            </p>
            <p class="mt-2 text-sm text-toned">
              Your dashboard is clear for now. Open the task list to plan ahead or refine metadata.
            </p>
          </div>

          <div
            v-else
            class="space-y-3"
          >
            <article
              v-for="task in todayTasks"
              :key="task.id"
              class="rounded-2xl border border-default/60 bg-background/65 p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-base font-semibold text-highlighted">
                      {{ task.title }}
                    </h3>
                    <UBadge
                      v-if="task.badge"
                      :color="badgeTone(task.badge)"
                      variant="subtle"
                    >
                      {{ task.badge }}
                    </UBadge>
                  </div>
                  <p class="mt-2 text-sm text-toned">
                    Due {{ task.deadline ? formatDate(task.deadline) : 'sometime soon' }}
                  </p>
                </div>

                <div class="grid min-w-[10rem] gap-2 text-right">
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-toned">
                      Estimated points
                    </p>
                    <p class="text-lg font-semibold text-primary">
                      {{ task.estimatedPoints }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-toned">
                      Progress
                    </p>
                    <p class="text-sm font-medium text-highlighted">
                      {{ task.progressPercent === null ? 'No subtasks' : `${task.progressPercent}%` }}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </UCard>

        <div class="space-y-6">
          <UCard class="border-default/70 bg-background/80 shadow-sm">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-highlighted">
                    Reward progress
                  </h2>
                  <p class="text-sm text-toned">
                    The closest reward to your current balance.
                  </p>
                </div>
                <UButton
                  to="/rewards"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-gift"
                >
                  Shop
                </UButton>
              </div>
            </template>

            <div
              v-if="rewardProgress.closestReward"
              class="space-y-4"
            >
              <div>
                <p class="text-xl font-semibold text-highlighted">
                  {{ rewardProgress.closestReward.name }}
                </p>
                <p class="mt-2 text-sm text-toned">
                  Costs {{ rewardProgress.closestReward.costPoints }} points.
                </p>
              </div>

              <div class="rounded-2xl border border-default/60 bg-muted/20 p-4">
                <p class="text-xs font-medium uppercase tracking-wide text-toned">
                  Remaining distance
                </p>
                <p class="mt-2 text-3xl font-bold text-primary">
                  {{ rewardProgress.closestReward.pointsNeeded }}
                </p>
                <p class="mt-2 text-sm text-toned">
                  <template v-if="rewardProgress.closestReward.pointsNeeded === 0">
                    You can afford this reward right now.
                  </template>
                  <template v-else>
                    Keep going. You are {{ rewardProgress.closestReward.pointsNeeded }} points away.
                  </template>
                </p>
              </div>
            </div>

            <div
              v-else
              class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-5 py-8 text-center"
            >
              <p class="text-base font-medium text-highlighted">
                No rewards configured yet
              </p>
              <p class="mt-2 text-sm text-toned">
                Add a reward to turn your point balance into something tangible.
              </p>
            </div>
          </UCard>

          <UCard class="border-default/70 bg-background/80 shadow-sm">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-highlighted">
                    Recent activity
                  </h2>
                  <p class="text-sm text-toned">
                    Latest balance changes across earned, spent, bonus, and manual updates.
                  </p>
                </div>
                <UButton
                  to="/rewards"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-right"
                  trailing
                >
                  Rewards
                </UButton>
              </div>
            </template>

            <div
              v-if="recentTransactions.length === 0"
              class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-5 py-8 text-center"
            >
              <p class="text-base font-medium text-highlighted">
                No activity yet
              </p>
              <p class="mt-2 text-sm text-toned">
                Once points move, your most recent transactions will appear here.
              </p>
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <article
                v-for="transaction in recentTransactions"
                :key="transaction.id"
                class="rounded-2xl border border-default/60 bg-background/65 p-4"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :color="transactionTone(transaction.type)"
                        variant="subtle"
                      >
                        {{ transaction.type }}
                      </UBadge>
                      <p class="text-sm font-medium text-highlighted">
                        {{ transaction.description }}
                      </p>
                    </div>
                    <p class="mt-2 text-xs uppercase tracking-wide text-toned">
                      {{ transaction.source }} · {{ formatDateTime(transaction.createdAt) }}
                    </p>
                  </div>
                  <p class="text-lg font-semibold text-primary">
                    {{ transaction.type === 'spent' ? '-' : '+' }}{{ transaction.amount }}
                  </p>
                </div>
              </article>
            </div>
          </UCard>
        </div>
      </section>

      <!-- ── Analytics summary ──────────────────────────────────────────────── -->
      <section class="grid gap-6 sm:grid-cols-2">
        <UCard class="border-default/70 bg-background/80 shadow-sm">
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">
              Most rewarding projects
            </h2>
            <p class="text-sm text-toned">
              Projects that have generated the most earned points.
            </p>
          </template>

          <div
            v-if="analyticsPending"
            class="space-y-3"
          >
            <USkeleton class="h-10 rounded-xl" />
            <USkeleton class="h-10 rounded-xl" />
          </div>

          <UAlert
            v-else-if="analyticsFetchError"
            color="error"
            variant="subtle"
            title="Could not load analytics"
            class="rounded-xl"
          >
            <template #description>
              <span>{{ (analyticsFetchError as { message?: string }).message ?? 'Unknown error' }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                class="ml-2"
                @click="refreshAnalytics()"
              >
                Retry
              </UButton>
            </template>
          </UAlert>

          <div
            v-else-if="mostRewardingProjects.length === 0"
            class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-5 py-8 text-center"
          >
            <p
              class="text-base font-medium text-highlighted"
            >
              No completed project activity yet
            </p>
            <p class="mt-2 text-sm text-toned">
              Complete tasks through Todoist to see which projects earn the most points.
            </p>
          </div>

          <div
            v-else
            class="space-y-3"
          >
            <article
              v-for="(project, index) in mostRewardingProjects"
              :key="project.projectId"
              class="flex items-center justify-between gap-3 rounded-2xl border border-default/60 bg-background/65 px-4 py-3"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-toned"
                >
                  {{ index + 1 }}
                </span>
                <p
                  class="truncate text-sm font-medium text-highlighted"
                >
                  {{ project.projectName }}
                </p>
              </div>
              <p
                class="shrink-0 text-base font-semibold text-primary"
              >
                {{ project.pointsEarned }} pts
              </p>
            </article>
          </div>
        </UCard>

        <UCard class="border-default/70 bg-background/80 shadow-sm">
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">
              Streak history
            </h2>
            <p class="text-sm text-toned">
              Lifetime best and milestones you've reached.
            </p>
          </template>

          <div
            v-if="analyticsPending"
            class="space-y-3"
          >
            <USkeleton class="h-10 rounded-xl" />
            <USkeleton class="h-10 rounded-xl" />
          </div>

          <div
            v-else
            class="space-y-5"
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="rounded-2xl border border-default/60 bg-muted/20 px-4 py-4">
                <p class="text-xs font-medium uppercase tracking-wide text-toned">
                  Current streak
                </p>
                <p class="mt-2 text-3xl font-bold text-primary">
                  {{ analyticsStreak.current }}
                </p>
              </div>
              <div class="rounded-2xl border border-default/60 bg-muted/20 px-4 py-4">
                <p class="text-xs font-medium uppercase tracking-wide text-toned">
                  Longest streak
                </p>
                <p class="mt-2 text-3xl font-bold text-highlighted">
                  {{ analyticsStreak.longest }}
                </p>
              </div>
            </div>

            <div>
              <p class="mb-3 text-xs font-medium uppercase tracking-wide text-toned">
                Milestones reached
              </p>
              <div
                v-if="analyticsStreak.milestonesReached.length === 0"
                class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-4 py-5 text-center"
              >
                <p class="text-sm text-toned">
                  Keep your streak going to reach your first milestone.
                </p>
              </div>
              <div
                v-else
                class="flex flex-wrap gap-2"
              >
                <UBadge
                  v-for="days in analyticsStreak.milestonesReached"
                  :key="days"
                  color="primary"
                  variant="subtle"
                >
                  {{ days }} days
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>
      </section>

      <div
        v-if="acknowledgeError"
        class="sticky bottom-4 z-20"
      >
        <UAlert
          color="error"
          variant="subtle"
          title="Could not update notification"
          :description="acknowledgeError"
        />
      </div>

      <div
        v-if="notifications.length > 0"
        class="pointer-events-none fixed inset-x-0 bottom-4 z-20 px-4"
      >
        <div class="mx-auto flex max-w-5xl flex-col gap-3">
          <div
            v-for="notification in notifications"
            :key="notification.id"
            class="pointer-events-auto rounded-2xl border border-default/70 bg-background/95 p-4 shadow-xl backdrop-blur"
          >
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="notificationTone(notification.severity)"
                    variant="subtle"
                  >
                    {{ notification.severity }}
                  </UBadge>
                  <p class="text-sm font-semibold text-highlighted">
                    {{ notification.title }}
                  </p>
                </div>
                <p class="mt-2 text-sm text-toned">
                  {{ notification.message }}
                </p>
                <p class="mt-2 text-xs uppercase tracking-wide text-toned">
                  {{ formatDateTime(notification.createdAt) }}
                </p>
              </div>

              <UButton
                v-if="notification.requiresAcknowledgement"
                :loading="acknowledgingId === notification.id"
                color="neutral"
                variant="outline"
                icon="i-lucide-check"
                @click="acknowledgeNotification(notification.id)"
              >
                Acknowledge
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
