<script setup lang="ts">
import type { GlobalSettingsResponse } from '#shared/types'

const { data: envelope, pending, error, refresh } = await useFetch<{ data: GlobalSettingsResponse }>('/api/settings', {
  credentials: 'include'
})

const form = ref<GlobalSettingsResponse | null>(null)

watch(
  () => envelope.value?.data,
  (next) => {
    if (!next) {
      form.value = null
      return
    }
    form.value = structuredClone(next)
  },
  { immediate: true }
)

const saving = ref(false)
const saveMessage = ref('')
const saveError = ref('')

const streakRuleOptions = [
  { value: 'completed_items', label: 'Completed items' },
  { value: 'points', label: 'Points' }
]

const bonusStrategyOptions = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'percentage', label: 'Percentage' }
]

async function saveSettings() {
  if (!form.value) return

  saveMessage.value = ''
  saveError.value = ''
  saving.value = true
  try {
    const f = form.value
    await $fetch('/api/settings', {
      method: 'PATCH',
      credentials: 'include',
      body: {
        points: {
          difficultyMultiplierBase: f.points.difficultyMultiplierBase,
          priorityMultipliers: { ...f.points.priorityMultipliers }
        },
        streak: {
          ruleType: f.streak.ruleType,
          ruleValue: f.streak.ruleValue,
          protectionEnabled: f.streak.protectionEnabled,
          startingProtectionBalance: f.streak.startingProtectionBalance,
          protectionRewardEveryNDays: f.streak.protectionRewardEveryNDays,
          protectionRewardAmount: f.streak.protectionRewardAmount,
          bonusStrategy: f.streak.bonusStrategy,
          milestonePercentageWindowDays: f.streak.milestonePercentageWindowDays,
          milestones: f.streak.milestones.map(m => ({
            days: m.days,
            fixedBonusPoints: m.fixedBonusPoints,
            percentageBonus: m.percentageBonus,
            isActive: m.isActive
          }))
        }
      }
    })
    await refresh()
    saveMessage.value = 'Settings saved.'
  } catch (e: unknown) {
    const err = e as { data?: { error?: { message?: string } } }
    saveError.value = err.data?.error?.message ?? 'Failed to save settings'
  } finally {
    saving.value = false
  }
}

function addMilestone() {
  if (!form.value) return
  form.value.streak.milestones.push({
    days: 1,
    fixedBonusPoints: 0,
    percentageBonus: 0,
    isActive: true
  })
}

function removeMilestone(index: number) {
  if (!form.value || form.value.streak.milestones.length <= 1) return
  form.value.streak.milestones.splice(index, 1)
}
</script>

<template>
  <div class="space-y-8">
    <section>
      <div class="space-y-2">
        <p class="text-xs font-semibold tracking-[0.2em] uppercase text-primary">
          Rules and scoring
        </p>
        <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
          Settings
        </h1>
        <p class="max-w-2xl text-base leading-7 text-toned">
          Point multipliers, streak rules, milestone bonuses, and other app-owned configuration apply going forward only.
        </p>
      </div>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load settings"
      :description="error.message"
    />

    <div
      v-if="pending"
      class="text-sm text-toned"
    >
      Loading settings…
    </div>

    <template v-else-if="form">
      <div class="flex flex-wrap items-center gap-3">
        <UButton
          label="Save changes"
          :loading="saving"
          :disabled="saving"
          @click="saveSettings"
        />
        <p
          v-if="saveMessage"
          class="text-sm font-medium text-success"
        >
          {{ saveMessage }}
        </p>
      </div>

      <UAlert
        v-if="saveError"
        color="error"
        variant="subtle"
        class="mt-4"
        :title="saveError"
      />

      <div class="grid gap-6 lg:grid-cols-1 xl:grid-cols-2">
        <UCard class="border-default/70 bg-background/80 shadow-sm">
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">
              Points
            </h2>
          </template>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Difficulty multiplier base">
              <UInput
                v-model.number="form.points.difficultyMultiplierBase"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
            <div class="sm:col-span-2 grid gap-3 sm:grid-cols-3">
              <UFormField label="Priority × low">
                <UInput
                  v-model.number="form.points.priorityMultipliers.low"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="Priority × medium">
                <UInput
                  v-model.number="form.points.priorityMultipliers.medium"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="Priority × high">
                <UInput
                  v-model.number="form.points.priorityMultipliers.high"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </UFormField>
            </div>
          </div>
        </UCard>

        <UCard class="border-default/70 bg-background/80 shadow-sm">
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">
              Streak
            </h2>
          </template>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Rule type">
              <USelect
                v-model="form.streak.ruleType"
                :items="streakRuleOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Rule value">
              <UInput
                v-model.number="form.streak.ruleValue"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
            <UFormField
              label="Protection"
              class="sm:col-span-2"
            >
              <div class="flex flex-wrap gap-4">
                <UCheckbox
                  v-model="form.streak.protectionEnabled"
                  label="Streak protection enabled"
                />
                <UFormField
                  label="Starting balance"
                  class="min-w-24"
                >
                  <UInput
                    v-model.number="form.streak.startingProtectionBalance"
                    type="number"
                    min="0"
                    step="1"
                  />
                </UFormField>
              </div>
            </UFormField>
            <UFormField label="Protection reward every N days">
              <UInput
                v-model.number="form.streak.protectionRewardEveryNDays"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
            <UFormField label="Protection reward amount">
              <UInput
                v-model.number="form.streak.protectionRewardAmount"
                type="number"
                min="0"
                step="1"
              />
            </UFormField>
            <UFormField label="Milestone bonus strategy">
              <USelect
                v-model="form.streak.bonusStrategy"
                :items="bonusStrategyOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Milestone % window (days)">
              <UInput
                v-model.number="form.streak.milestonePercentageWindowDays"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
          </div>
        </UCard>
      </div>

      <UCard class="border-default/70 bg-background/80 shadow-sm">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
              Milestones
            </h2>
            <UButton
              label="Add milestone"
              variant="outline"
              size="sm"
              @click="addMilestone"
            />
          </div>
        </template>

        <div class="space-y-4">
          <div
            v-for="(milestone, index) in form.streak.milestones"
            :key="`${milestone.days}-${index}`"
            class="grid gap-3 rounded-xl border border-default/60 p-4 sm:grid-cols-2 lg:grid-cols-12 lg:items-end"
          >
            <UFormField
              label="Days"
              class="lg:col-span-2"
            >
              <UInput
                v-model.number="milestone.days"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
            <UFormField
              label="Fixed bonus (pts)"
              class="lg:col-span-2"
            >
              <UInput
                v-model.number="milestone.fixedBonusPoints"
                type="number"
                min="0"
                step="1"
              />
            </UFormField>
            <UFormField
              label="% bonus"
              class="lg:col-span-2"
            >
              <UInput
                v-model.number="milestone.percentageBonus"
                type="number"
                min="0"
                step="0.01"
              />
            </UFormField>
            <UFormField
              label="Active"
              class="lg:col-span-3 flex items-end pb-1"
            >
              <UCheckbox v-model="milestone.isActive" />
            </UFormField>
            <div class="lg:col-span-3 flex justify-end">
              <UButton
                label="Remove"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="form.streak.milestones.length <= 1"
                @click="removeMilestone(index)"
              />
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
