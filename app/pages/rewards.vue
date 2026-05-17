<script setup lang="ts">
import type { PointsSummary, RedemptionRecord, Reward, RewardRedemptionResult } from '../../shared/types'

interface RewardsListData {
  rewards: Reward[]
  pointsSummary: PointsSummary
  meta: { page: number, pageSize: number, total: number }
}

interface RedemptionsData {
  redemptions: RedemptionRecord[]
  meta: { page: number, pageSize: number, total: number }
}

const includeArchived = ref(false)

const { data: listEnvelope, pending: listPending, error: listError, refresh: refreshList } = await useFetch<{ data: RewardsListData }>('/api/rewards', {
  credentials: 'include',
  query: {
    includeArchived,
    page: 1,
    pageSize: 50
  }
})

const { data: redemptionsEnvelope, pending: redemptionsPending, error: redemptionsError, refresh: refreshRedemptions } = await useFetch<{ data: RedemptionsData }>('/api/rewards/redemptions', {
  credentials: 'include',
  query: { page: 1, pageSize: 20 }
})

const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const saveError = ref('')
const redeemingId = ref<string | null>(null)
const redeemError = ref('')

const form = reactive({
  name: '',
  description: '',
  category: '',
  costPoints: 10 as number
})

const pointsSummary = computed(() => listEnvelope.value?.data.pointsSummary ?? null)
const rewards = computed(() => listEnvelope.value?.data.rewards ?? [])
const redemptions = computed(() => redemptionsEnvelope.value?.data.redemptions ?? [])
const redemptionsMeta = computed(() => redemptionsEnvelope.value?.data.meta)

function openCreate() {
  editingId.value = null
  form.name = ''
  form.description = ''
  form.category = ''
  form.costPoints = 10
  saveError.value = ''
  modalOpen.value = true
}

function openEdit(reward: Reward) {
  editingId.value = reward.id
  form.name = reward.name
  form.description = reward.description ?? ''
  form.category = reward.category ?? ''
  form.costPoints = reward.costPoints
  saveError.value = ''
  modalOpen.value = true
}

async function saveModal() {
  saveError.value = ''
  saving.value = true
  try {
    const body = {
      name: form.name.trim(),
      description: form.description.trim().length ? form.description.trim() : null,
      category: form.category.trim().length ? form.category.trim() : null,
      costPoints: form.costPoints
    }

    if (editingId.value) {
      await $fetch(`/api/rewards/${editingId.value}`, {
        method: 'PATCH',
        credentials: 'include',
        body
      })
    } else {
      await $fetch('/api/rewards', {
        method: 'POST',
        credentials: 'include',
        body
      })
    }

    modalOpen.value = false
    await Promise.all([refreshList(), refreshRedemptions()])
  } catch (e: unknown) {
    const err = e as { data?: { error?: { message?: string } } }
    saveError.value = err.data?.error?.message ?? 'Could not save reward'
  } finally {
    saving.value = false
  }
}

async function archiveReward(reward: Reward) {
  if (!confirm(`Archive “${reward.name}”? It will disappear from the shop unless you show archived items.`)) {
    return
  }

  try {
    await $fetch(`/api/rewards/${reward.id}`, {
      method: 'PATCH',
      credentials: 'include',
      body: { isArchived: true }
    })
    await Promise.all([refreshList(), refreshRedemptions()])
  } catch {
    // noop — optional toast
  }
}

async function redeemReward(reward: Reward) {
  if (redeemingId.value) {
    return
  }

  redeemError.value = ''
  redeemingId.value = reward.id

  const idempotencyKey = crypto.randomUUID()

  try {
    await $fetch<{ data: RewardRedemptionResult }>(`/api/rewards/${reward.id}/redeem`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Idempotency-Key': idempotencyKey
      }
    })

    await Promise.all([refreshList(), refreshRedemptions()])
  } catch (e: unknown) {
    const err = e as { data?: { error?: { message?: string } } }
    redeemError.value = err.data?.error?.message ?? 'Could not redeem reward'
  } finally {
    redeemingId.value = null
  }
}
</script>

<template>
  <div class="space-y-10">
    <section>
      <div class="space-y-2">
        <p class="text-xs font-semibold tracking-[0.2em] uppercase text-primary">
          Reward economy
        </p>
        <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
          Rewards
        </h1>
        <p class="max-w-2xl text-base leading-7 text-toned">
          Build your reward catalog, see affordability from your live balance, redeem rewards, and track redemption history.
        </p>
      </div>
    </section>

    <UAlert
      v-if="listError"
      color="error"
      variant="subtle"
      title="Could not load rewards"
      :description="listError.message"
    />

    <!-- Section A — balance -->
    <UCard class="border-default/70 bg-background/80 shadow-sm">
      <template #header>
        <h2 class="text-lg font-semibold text-highlighted">
          Points balance
        </h2>
      </template>

      <div
        v-if="listPending"
        class="grid gap-4 sm:grid-cols-3"
      >
        <USkeleton class="h-12 w-full rounded-lg" />
        <USkeleton class="h-12 w-full rounded-lg" />
        <USkeleton class="h-12 w-full rounded-lg" />
      </div>

      <div
        v-else-if="pointsSummary"
        class="grid gap-6 sm:grid-cols-3"
      >
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-toned">
            Current balance
          </p>
          <p class="mt-1 text-3xl font-bold text-primary">
            {{ pointsSummary.currentBalance }}
          </p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-toned">
            Lifetime earned
          </p>
          <p class="mt-1 text-2xl font-semibold text-highlighted">
            {{ pointsSummary.lifetimeEarned }}
          </p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-toned">
            Lifetime spent
          </p>
          <p class="mt-1 text-2xl font-semibold text-highlighted">
            {{ pointsSummary.lifetimeSpent }}
          </p>
        </div>
      </div>
    </UCard>

    <!-- Section B — catalog -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <UButton
          label="Add reward"
          icon="i-lucide-plus"
          @click="openCreate"
        />
        <UCheckbox
          v-model="includeArchived"
          label="Show archived"
        />
      </div>
    </div>

    <UAlert
      v-if="redeemError"
      color="error"
      variant="subtle"
      title="Could not redeem reward"
      :description="redeemError"
    />

    <div
      v-if="listPending"
      class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-48 rounded-xl"
      />
    </div>

    <div
      v-else-if="rewards.length === 0"
      class="rounded-xl border border-dashed border-default/60 bg-muted/20 px-6 py-12 text-center"
    >
      <p class="text-lg font-medium text-highlighted">
        No rewards yet
      </p>
      <p class="mt-2 max-w-md mx-auto text-sm text-toned">
        Create your first reward to stay motivated. You can set the point cost and we’ll show whether you can afford it from your current balance.
      </p>
      <UButton
        class="mt-6"
        label="Add your first reward"
        @click="openCreate"
      />
    </div>

    <div
      v-else
      class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <UCard
        v-for="reward in rewards"
        :key="reward.id"
        class="border-default/70 bg-background/80 shadow-sm flex flex-col"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold text-highlighted truncate">
              {{ reward.name }}
            </h3>
            <UBadge
              v-if="reward.category"
              color="neutral"
              variant="subtle"
              class="mt-2"
            >
              {{ reward.category }}
            </UBadge>
            <UBadge
              v-if="reward.isArchived"
              color="warning"
              variant="subtle"
              class="mt-2 ml-1"
            >
              Archived
            </UBadge>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Edit reward"
              @click="openEdit(reward)"
            />
            <UButton
              v-if="!reward.isArchived"
              icon="i-lucide-archive"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Archive reward"
              @click="archiveReward(reward)"
            />
          </div>
        </div>

        <p class="mt-3 text-sm text-toned line-clamp-2 flex-1">
          {{ reward.description || '—' }}
        </p>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-default/40 pt-4">
          <span class="text-sm font-medium text-highlighted">
            {{ reward.costPoints }} pts
          </span>
          <UBadge
            v-if="reward.affordability?.canRedeem"
            color="success"
            variant="subtle"
          >
            Affordable
          </UBadge>
          <UBadge
            v-else
            color="warning"
            variant="subtle"
          >
            Need {{ reward.affordability?.missingPoints ?? reward.costPoints }} more pts
          </UBadge>
        </div>

        <UButton
          class="mt-4 w-full justify-center"
          :label="redeemingId === reward.id ? 'Redeeming…' : 'Redeem'"
          :loading="redeemingId === reward.id"
          :disabled="!reward.affordability?.canRedeem || redeemingId !== null"
          @click="redeemReward(reward)"
        />
      </UCard>
    </div>

    <!-- Section D — redemption history -->
    <UCard class="border-default/70 bg-background/80 shadow-sm">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            Redemption history
          </h2>
          <p class="text-sm text-toned mt-1">
            {{ redemptionsMeta ? `${redemptionsMeta.total} total` : '' }}
          </p>
        </div>
      </template>

      <UAlert
        v-if="redemptionsError"
        color="error"
        variant="subtle"
        title="Could not load redemptions"
        :description="redemptionsError.message"
      />

      <div
        v-else-if="redemptionsPending"
        class="space-y-2"
      >
        <USkeleton class="h-10 w-full rounded" />
        <USkeleton class="h-10 w-full rounded" />
      </div>

      <div
        v-else-if="redemptions.length === 0"
        class="text-sm text-toned py-4"
      >
        No redemptions yet. When you redeem rewards, they’ll appear here.
      </div>

      <div
        v-else
        class="overflow-x-auto"
      >
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default/60 text-left text-toned">
              <th class="py-2 pr-4 font-medium">
                Reward
              </th>
              <th class="py-2 pr-4 font-medium">
                Cost (pts)
              </th>
              <th class="py-2 font-medium">
                Redeemed at
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in redemptions"
              :key="r.id"
              class="border-b border-default/30"
            >
              <td class="py-2 pr-4 text-highlighted">
                {{ r.rewardName }}
              </td>
              <td class="py-2 pr-4">
                {{ r.costPoints }}
              </td>
              <td class="py-2 text-toned">
                {{ new Date(r.redeemedAt).toLocaleString() }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Edit reward' : 'New reward'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="Name"
            required
          >
            <UInput
              v-model="form.name"
              placeholder="e.g. Cinema night"
            />
          </UFormField>
          <UFormField label="Description">
            <UTextarea
              v-model="form.description"
              :rows="3"
              autoresize
              placeholder="Optional details"
            />
          </UFormField>
          <UFormField label="Category">
            <UInput
              v-model="form.category"
              placeholder="Optional tag"
            />
          </UFormField>
          <UFormField
            label="Cost (points)"
            required
          >
            <UInput
              v-model.number="form.costPoints"
              type="number"
              min="1"
              step="1"
            />
          </UFormField>
          <UAlert
            v-if="saveError"
            color="error"
            variant="subtle"
            :title="saveError"
          />
          <div class="flex justify-end gap-2 pt-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="modalOpen = false"
            />
            <UButton
              label="Save"
              :loading="saving"
              :disabled="saving || !form.name.trim()"
              @click="saveModal"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
