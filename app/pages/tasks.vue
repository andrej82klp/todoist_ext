<script setup lang="ts">
import type {
  ApiCollectionResponse,
  ApiErrorResponse,
  ApiSuccessResponse,
  EnrichedTask,
  EnrichedTaskDetail,
  TaskListMeta,
  TodoistTaskMetadata
} from '../../shared/types'

type SortByValue = 'none' | 'priority' | 'difficulty' | 'estimatedPoints' | 'deadline'

const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()

const selectedProjectId = ref('')
const selectedSortBy = ref<SortByValue>('none')
const selectedSortOrder = ref<'asc' | 'desc'>('asc')
const includeCompleted = ref(false)
const currentPage = ref(1)

const routeHydrated = ref(false)
const applyingRouteQuery = ref(false)

const editorOpen = ref(false)
const editingTaskId = ref<string | null>(null)
const detailPending = ref(false)
const detailError = ref('')
const detail = ref<EnrichedTaskDetail | null>(null)
const savingMetadata = ref(false)
const saveError = ref('')

const metadataForm = reactive<TodoistTaskMetadata>({
  priority: 'medium',
  difficulty: 1,
  timeEstimateMinutes: null,
  completionBonusEnabled: true,
  completionBonusPercent: 10,
  badge: null,
  customPointOverride: null
})

const metadataTimeEstimateInput = computed({
  get: () => metadataForm.timeEstimateMinutes === null ? '' : String(metadataForm.timeEstimateMinutes),
  set: (value: string | number) => {
    const normalized = String(value ?? '').trim()
    metadataForm.timeEstimateMinutes = normalized.length > 0 ? Number.parseInt(normalized, 10) : null
  }
})

const metadataCustomOverrideInput = computed({
  get: () => metadataForm.customPointOverride === null ? '' : String(metadataForm.customPointOverride),
  set: (value: string | number) => {
    const normalized = String(value ?? '').trim()
    metadataForm.customPointOverride = normalized.length > 0 ? Number.parseInt(normalized, 10) : null
  }
})

const sortByOptions = [
  { value: 'none', label: 'Default order' },
  { value: 'priority', label: 'Priority' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'estimatedPoints', label: 'Estimated points' },
  { value: 'deadline', label: 'Deadline' }
]

const sortOrderOptions = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' }
]

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
]

function asQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return typeof value === 'string' ? value : undefined
}

function parsePositivePage(value: unknown): number {
  const parsed = Number.parseInt(asQueryValue(value) ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function parseRouteQuery(query: Record<string, unknown>) {
  const sortBy = asQueryValue(query.sortBy)
  const sortOrder = asQueryValue(query.sortOrder)

  return {
    projectId: asQueryValue(query.projectId) ?? '',
    sortBy: sortBy && ['priority', 'difficulty', 'estimatedPoints', 'deadline'].includes(sortBy)
      ? (sortBy as SortByValue)
      : 'none',
    sortOrder: sortOrder === 'desc' ? 'desc' : 'asc',
    includeCompleted: asQueryValue(query.includeCompleted) === 'true',
    page: parsePositivePage(query.page)
  }
}

function normalizeRouteQuery(query: Record<string, unknown>) {
  const normalized: Record<string, string> = {}
  const projectId = asQueryValue(query.projectId)
  const sortBy = asQueryValue(query.sortBy)
  const sortOrder = asQueryValue(query.sortOrder)
  const includeCompletedValue = asQueryValue(query.includeCompleted)
  const pageValue = asQueryValue(query.page)

  if (projectId) normalized.projectId = projectId
  if (sortBy && ['priority', 'difficulty', 'estimatedPoints', 'deadline'].includes(sortBy)) {
    normalized.sortBy = sortBy
  }
  if (normalized.sortBy && sortOrder === 'desc') {
    normalized.sortOrder = 'desc'
  }
  if (includeCompletedValue === 'true') {
    normalized.includeCompleted = 'true'
  }
  if (pageValue) {
    const parsedPage = Number.parseInt(pageValue, 10)
    if (Number.isFinite(parsedPage) && parsedPage > 1) {
      normalized.page = String(parsedPage)
    }
  }

  return normalized
}

function buildRouteQueryFromState(): Record<string, string> {
  const query: Record<string, string> = {}

  if (selectedProjectId.value) {
    query.projectId = selectedProjectId.value
  }
  if (selectedSortBy.value !== 'none') {
    query.sortBy = selectedSortBy.value
    if (selectedSortOrder.value === 'desc') {
      query.sortOrder = 'desc'
    }
  }
  if (includeCompleted.value) {
    query.includeCompleted = 'true'
  }
  if (currentPage.value > 1) {
    query.page = String(currentPage.value)
  }

  return query
}

function applyQueryToState(query: Record<string, unknown>) {
  const parsed = parseRouteQuery(query)

  applyingRouteQuery.value = true
  selectedProjectId.value = parsed.projectId
  selectedSortBy.value = parsed.sortBy
  selectedSortOrder.value = parsed.sortOrder
  includeCompleted.value = parsed.includeCompleted
  currentPage.value = parsed.page
  applyingRouteQuery.value = false
}

applyQueryToState(route.query)
routeHydrated.value = true

watch(
  () => route.query,
  (nextQuery) => {
    applyQueryToState(nextQuery)
  }
)

watch([selectedProjectId, selectedSortBy, selectedSortOrder, includeCompleted], () => {
  if (!routeHydrated.value || applyingRouteQuery.value) return
  if (currentPage.value !== 1) {
    currentPage.value = 1
  }
})

watch([selectedProjectId, selectedSortBy, selectedSortOrder, includeCompleted, currentPage], async () => {
  if (!routeHydrated.value || applyingRouteQuery.value) return

  const currentQuery = normalizeRouteQuery(route.query)
  const nextQuery = buildRouteQueryFromState()

  if (JSON.stringify(currentQuery) === JSON.stringify(nextQuery)) {
    return
  }

  await router.replace({ query: nextQuery })
})

const listQuery = computed(() => ({
  projectId: selectedProjectId.value || undefined,
  sortBy: selectedSortBy.value === 'none' ? undefined : selectedSortBy.value,
  sortOrder: selectedSortBy.value === 'none' ? undefined : selectedSortOrder.value,
  includeCompleted: includeCompleted.value,
  page: currentPage.value,
  pageSize: PAGE_SIZE
}))

type TaskListResponse = ApiCollectionResponse<EnrichedTask, TaskListMeta>

const {
  data: listEnvelope,
  pending: listPending,
  error: listError,
  refresh: refreshList
} = await useFetch<TaskListResponse>('/api/tasks', {
  credentials: 'include',
  query: listQuery
})

const tasks = computed(() => listEnvelope.value?.data ?? [])
const listMeta = computed<TaskListMeta>(() => listEnvelope.value?.meta ?? {
  page: currentPage.value,
  pageSize: PAGE_SIZE,
  total: 0,
  availableProjects: []
})

const availableProjects = computed(() => listMeta.value.availableProjects)

const projectFilterOptions = computed(() => {
  const options = [
    {
      id: '',
      name: 'All projects'
    },
    ...availableProjects.value
  ]

  if (selectedProjectId.value && !options.some(option => option.id === selectedProjectId.value)) {
    options.push({
      id: selectedProjectId.value,
      name: selectedProjectId.value
    })
  }

  return options
})

const totalPages = computed(() => {
  if (listMeta.value.total <= 0) return 1
  return Math.max(1, Math.ceil(listMeta.value.total / listMeta.value.pageSize))
})

watch([() => listMeta.value.total, () => listMeta.value.pageSize], () => {
  if (currentPage.value > totalPages.value) {
    currentPage.value = totalPages.value
  }
})

function goToPage(page: number) {
  currentPage.value = Math.max(1, Math.min(page, totalPages.value))
}

function resetMetadataForm(metadata: TodoistTaskMetadata) {
  metadataForm.priority = metadata.priority
  metadataForm.difficulty = metadata.difficulty
  metadataForm.timeEstimateMinutes = metadata.timeEstimateMinutes
  metadataForm.completionBonusEnabled = metadata.completionBonusEnabled
  metadataForm.completionBonusPercent = metadata.completionBonusPercent
  metadataForm.badge = metadata.badge
  metadataForm.customPointOverride = metadata.customPointOverride
}

watch(
  () => metadataForm.completionBonusEnabled,
  (isEnabled) => {
    if (!isEnabled) {
      metadataForm.completionBonusPercent = 0
    }
  }
)

function parseApiErrorMessage(fetchError: unknown, fallbackMessage: string): string {
  const candidate = fetchError as {
    data?: ApiErrorResponse
    message?: string
  }

  const details = candidate.data?.error?.details as { fields?: Record<string, string[]> } | undefined
  const fieldErrors = details?.fields

  if (fieldErrors) {
    const firstEntry = Object.entries(fieldErrors)[0]
    if (firstEntry) {
      const [field, messages] = firstEntry
      if (messages.length > 0) {
        return field === '_root'
          ? messages[0]
          : `${field}: ${messages[0]}`
      }
    }
  }

  return candidate.data?.error?.message ?? candidate.message ?? fallbackMessage
}

let detailRequestId = 0

async function loadTaskDetail(taskId: string) {
  const requestId = ++detailRequestId

  detailPending.value = true
  detailError.value = ''
  saveError.value = ''

  try {
    const response = await $fetch<ApiSuccessResponse<EnrichedTaskDetail>>(`/api/tasks/${taskId}`, {
      credentials: 'include'
    })

    if (requestId !== detailRequestId) {
      return
    }

    detail.value = response.data
    resetMetadataForm(response.data.metadata)
  } catch (fetchError: unknown) {
    if (requestId !== detailRequestId) {
      return
    }
    detailError.value = parseApiErrorMessage(fetchError, 'Could not load task details')
    detail.value = null
  } finally {
    if (requestId === detailRequestId) {
      detailPending.value = false
    }
  }
}

async function openEditor(task: EnrichedTask) {
  editorOpen.value = true
  editingTaskId.value = task.id
  await loadTaskDetail(task.id)
}

function closeEditor() {
  editorOpen.value = false
  editingTaskId.value = null
  detail.value = null
  detailError.value = ''
  saveError.value = ''
}

async function saveTaskMetadata() {
  if (!editingTaskId.value) {
    return
  }

  savingMetadata.value = true
  saveError.value = ''

  try {
    await $fetch(`/api/tasks/${editingTaskId.value}/metadata`, {
      method: 'PATCH',
      credentials: 'include',
      body: {
        priority: metadataForm.priority,
        difficulty: metadataForm.difficulty,
        timeEstimateMinutes: metadataForm.timeEstimateMinutes,
        completionBonusEnabled: metadataForm.completionBonusEnabled,
        completionBonusPercent: metadataForm.completionBonusPercent,
        badge: metadataForm.badge,
        customPointOverride: metadataForm.customPointOverride
      }
    })

    closeEditor()
    await refreshList()
  } catch (fetchError: unknown) {
    saveError.value = parseApiErrorMessage(fetchError, 'Could not save metadata')
  } finally {
    savingMetadata.value = false
  }
}

function formatDate(value: string | null) {
  if (!value) return 'No deadline'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${value}T00:00:00Z`))
}

function progressLabel(task: EnrichedTask) {
  if (!task.eligibleForProgressTracking) {
    return 'No subtasks'
  }
  return `${task.progressPercent ?? 0}%`
}

function taskPriorityColor(priority: TodoistTaskMetadata['priority']) {
  switch (priority) {
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
      return 'neutral'
  }
}

function deadlineColor(task: EnrichedTask) {
  if (!task.deadline) return 'neutral'
  return task.isDeadlineApproaching ? 'error' : 'primary'
}
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-2">
      <p class="text-xs font-semibold tracking-[0.2em] uppercase text-primary">
        Task planning
      </p>
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
        Tasks
      </h1>
      <p class="max-w-3xl text-base leading-7 text-toned">
        Browse synced Todoist work, tune metadata, and use estimated points plus progress signals to decide what to tackle next.
      </p>
    </section>

    <UCard class="border-default/70 bg-background/80 shadow-sm">
      <div class="grid gap-4 lg:grid-cols-[minmax(200px,1fr)_minmax(170px,220px)_minmax(170px,220px)_auto]">
        <UFormField label="Project">
          <select
            v-model="selectedProjectId"
            data-testid="tasks-project-filter"
            class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm"
          >
            <option
              v-for="option in projectFilterOptions"
              :key="option.id || 'all-projects'"
              :value="option.id"
            >
              {{ option.name }}
            </option>
          </select>
        </UFormField>

        <UFormField label="Sort by">
          <select
            v-model="selectedSortBy"
            data-testid="tasks-sort-by"
            class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm"
          >
            <option
              v-for="option in sortByOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </UFormField>

        <UFormField label="Sort order">
          <select
            v-model="selectedSortOrder"
            data-testid="tasks-sort-order"
            :disabled="selectedSortBy === 'none'"
            class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            <option
              v-for="option in sortOrderOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </UFormField>

        <UFormField label="Completed tasks">
          <div class="h-full flex items-end">
            <UCheckbox
              v-model="includeCompleted"
              label="Include completed"
            />
          </div>
        </UFormField>
      </div>
    </UCard>

    <UAlert
      v-if="listError"
      color="error"
      variant="subtle"
      title="Could not load tasks"
      :description="listError.message"
    >
      <template #footer>
        <UButton
          label="Retry"
          size="sm"
          @click="refreshList"
        />
      </template>
    </UAlert>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-toned">
          {{ listMeta.total }} task{{ listMeta.total === 1 ? '' : 's' }} in this view
        </p>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="currentPage <= 1 || listPending"
            @click="goToPage(currentPage - 1)"
          />
          <span class="text-sm text-toned min-w-28 text-center">
            Page {{ currentPage }} of {{ totalPages }}
          </span>
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="currentPage >= totalPages || listPending"
            @click="goToPage(currentPage + 1)"
          />
        </div>
      </div>

      <div
        v-if="listPending"
        class="space-y-3"
      >
        <USkeleton
          v-for="n in 6"
          :key="n"
          class="h-16 rounded-xl"
        />
      </div>

      <div
        v-else-if="tasks.length === 0"
        class="rounded-2xl border border-dashed border-default/60 bg-muted/20 px-6 py-12 text-center"
      >
        <p class="text-lg font-semibold text-highlighted">
          No tasks in this view
        </p>
        <p class="mt-2 max-w-xl mx-auto text-sm text-toned">
          Try changing the project filter, sorting, or completed-state toggle. If this is your first login, complete your initial sync and return here.
        </p>
      </div>

      <div
        v-else
        class="space-y-4"
      >
        <UCard class="hidden lg:block border-default/70 bg-background/80 shadow-sm overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default/60 text-left text-toned">
                <th class="py-3 pr-4 font-medium">
                  Task
                </th>
                <th class="py-3 pr-4 font-medium">
                  Priority / Difficulty
                </th>
                <th class="py-3 pr-4 font-medium">
                  Estimated points
                </th>
                <th class="py-3 pr-4 font-medium">
                  Deadline
                </th>
                <th class="py-3 pr-4 font-medium">
                  Progress
                </th>
                <th class="py-3 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="task in tasks"
                :key="task.id"
                class="border-b border-default/30 align-top"
                :data-testid="`task-row-${task.todoistTaskId}`"
              >
                <td class="py-3 pr-4">
                  <p class="font-medium text-highlighted leading-6">
                    {{ task.title }}
                  </p>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      {{ task.projectName ?? 'No project' }}
                    </UBadge>
                    <UBadge
                      v-if="task.isCompleted"
                      color="success"
                      variant="subtle"
                    >
                      Completed
                    </UBadge>
                  </div>
                </td>
                <td class="py-3 pr-4">
                  <div class="flex items-center gap-2">
                    <UBadge
                      :color="taskPriorityColor(task.metadata.priority)"
                      variant="soft"
                    >
                      {{ task.metadata.priority }}
                    </UBadge>
                    <span class="text-toned">Difficulty {{ task.metadata.difficulty }}/10</span>
                  </div>
                </td>
                <td class="py-3 pr-4">
                  <p
                    class="text-xl font-semibold text-primary leading-6"
                    :data-testid="`task-points-${task.todoistTaskId}`"
                  >
                    {{ task.estimatedPoints }}
                  </p>
                </td>
                <td class="py-3 pr-4">
                  <div class="space-y-1">
                    <UBadge
                      :color="deadlineColor(task)"
                      variant="subtle"
                    >
                      {{ formatDate(task.deadline) }}
                    </UBadge>
                    <p
                      v-if="task.isDeadlineApproaching"
                      class="text-xs font-medium text-error"
                    >
                      Due soon
                    </p>
                  </div>
                </td>
                <td class="py-3 pr-4">
                  <div class="space-y-1">
                    <p class="font-medium text-highlighted">
                      {{ progressLabel(task) }}
                    </p>
                    <p
                      v-if="task.eligibleForProgressTracking"
                      class="text-xs text-toned"
                    >
                      {{ task.completedSubtaskCount }} / {{ task.subtaskCount }} subtasks complete
                    </p>
                    <p
                      v-else
                      class="text-xs text-toned"
                    >
                      Progress tracking starts after subtasks are synced.
                    </p>
                  </div>
                </td>
                <td class="py-3 text-right">
                  <UButton
                    label="Edit"
                    icon="i-lucide-pencil"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :data-testid="`task-edit-${task.todoistTaskId}`"
                    @click="openEditor(task)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>

        <div class="grid gap-3 lg:hidden">
          <UCard
            v-for="task in tasks"
            :key="`${task.id}-mobile`"
            class="border-default/70 bg-background/80 shadow-sm"
            :data-testid="`task-row-${task.todoistTaskId}`"
          >
            <div class="space-y-4">
              <div>
                <p class="font-semibold text-highlighted leading-6">
                  {{ task.title }}
                </p>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ task.projectName ?? 'No project' }}
                  </UBadge>
                  <UBadge
                    :color="taskPriorityColor(task.metadata.priority)"
                    variant="soft"
                  >
                    {{ task.metadata.priority }}
                  </UBadge>
                  <UBadge
                    v-if="task.isCompleted"
                    color="success"
                    variant="subtle"
                  >
                    Completed
                  </UBadge>
                </div>
              </div>

              <dl class="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt class="text-xs uppercase tracking-wide text-toned">
                    Difficulty
                  </dt>
                  <dd class="mt-1 font-medium text-highlighted">
                    {{ task.metadata.difficulty }} / 10
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-toned">
                    Estimated points
                  </dt>
                  <dd class="mt-1 text-xl font-semibold text-primary">
                    {{ task.estimatedPoints }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-toned">
                    Deadline
                  </dt>
                  <dd class="mt-1 space-y-1">
                    <UBadge
                      :color="deadlineColor(task)"
                      variant="subtle"
                    >
                      {{ formatDate(task.deadline) }}
                    </UBadge>
                    <p
                      v-if="task.isDeadlineApproaching"
                      class="text-xs font-medium text-error"
                    >
                      Due soon
                    </p>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-toned">
                    Progress
                  </dt>
                  <dd class="mt-1 font-medium text-highlighted">
                    {{ progressLabel(task) }}
                  </dd>
                </div>
              </dl>

              <UButton
                label="Edit metadata"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="sm"
                :data-testid="`task-edit-${task.todoistTaskId}`"
                @click="openEditor(task)"
              />
            </div>
          </UCard>
        </div>
      </div>
    </section>

    <UModal
      v-model:open="editorOpen"
      title="Task metadata"
      :dismissible="!savingMetadata"
      @update:open="(isOpen) => { if (!isOpen) closeEditor() }"
    >
      <template #body>
        <div class="space-y-5">
          <div
            v-if="detailPending"
            class="space-y-2"
          >
            <USkeleton class="h-5 w-3/4 rounded" />
            <USkeleton class="h-16 w-full rounded" />
            <USkeleton class="h-24 w-full rounded" />
          </div>

          <UAlert
            v-else-if="detailError"
            color="error"
            variant="subtle"
            title="Could not load task details"
            :description="detailError"
          >
            <template #footer>
              <UButton
                label="Retry"
                size="sm"
                @click="editingTaskId && loadTaskDetail(editingTaskId)"
              />
            </template>
          </UAlert>

          <template v-else-if="detail">
            <div class="space-y-2 rounded-2xl border border-default/70 bg-muted/20 p-4">
              <p class="font-semibold text-highlighted">
                {{ detail.title }}
              </p>
              <p class="text-sm text-toned">
                {{ detail.projectName ?? 'No project' }} · {{ detail.estimatedPoints }} estimated points
              </p>
              <p class="text-sm text-toned">
                Progress: {{ progressLabel(detail) }}
                <span v-if="detail.eligibleForProgressTracking">({{ detail.completedSubtaskCount }}/{{ detail.subtaskCount }} subtasks)</span>
              </p>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Priority">
                <select
                  v-model="metadataForm.priority"
                  data-testid="metadata-priority"
                  class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm"
                >
                  <option
                    v-for="option in priorityOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </UFormField>

              <UFormField label="Difficulty (1-10)">
                <UInput
                  v-model.number="metadataForm.difficulty"
                  data-testid="metadata-difficulty"
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                />
              </UFormField>

              <UFormField label="Time estimate (minutes)">
                <UInput
                  v-model="metadataTimeEstimateInput"
                  data-testid="metadata-time-estimate"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Optional"
                />
              </UFormField>

              <UFormField label="Custom point override">
                <UInput
                  v-model="metadataCustomOverrideInput"
                  data-testid="metadata-custom-override"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Optional"
                />
              </UFormField>

              <UFormField
                label="Badge"
                class="sm:col-span-2"
              >
                <UInput
                  data-testid="metadata-badge"
                  :model-value="metadataForm.badge ?? ''"
                  placeholder="Optional label"
                  @update:model-value="(value) => metadataForm.badge = String(value).trim().length ? String(value).trim() : null"
                />
              </UFormField>

              <UFormField
                label="Completion bonus"
                class="sm:col-span-2"
              >
                <div class="flex flex-wrap items-center gap-3">
                  <UCheckbox
                    v-model="metadataForm.completionBonusEnabled"
                    data-testid="metadata-bonus-enabled"
                    label="Enable completion bonus"
                  />
                  <UInput
                    v-model.number="metadataForm.completionBonusPercent"
                    data-testid="metadata-bonus-percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    class="w-28"
                    :disabled="!metadataForm.completionBonusEnabled"
                  />
                  <span class="text-sm text-toned">percent</span>
                </div>
              </UFormField>
            </div>

            <div class="space-y-2">
              <p class="text-sm font-semibold text-highlighted">
                Subtasks
              </p>

              <p
                v-if="detail.subtasks.length === 0"
                class="text-sm text-toned"
              >
                No subtasks synced for this task yet.
              </p>

              <div
                v-else
                class="space-y-2 rounded-xl border border-default/60 bg-background/70 p-3"
              >
                <div
                  v-for="subtask in detail.subtasks"
                  :key="subtask.id"
                  class="flex items-center justify-between gap-3 text-sm"
                >
                  <p class="text-highlighted">
                    {{ subtask.title }}
                  </p>
                  <UBadge
                    :color="subtask.isCompleted ? 'success' : 'neutral'"
                    variant="subtle"
                  >
                    {{ subtask.isCompleted ? 'Completed' : 'Open' }}
                  </UBadge>
                </div>
              </div>
            </div>

            <UAlert
              v-if="saveError"
              color="error"
              variant="subtle"
              :title="saveError"
            />

            <div class="flex justify-end gap-2">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                :disabled="savingMetadata"
                @click="closeEditor"
              />
              <UButton
                label="Save metadata"
                data-testid="metadata-save"
                :loading="savingMetadata"
                :disabled="savingMetadata"
                @click="saveTaskMetadata"
              />
            </div>
          </template>
        </div>
      </template>
    </UModal>
  </div>
</template>
