<script setup lang="ts">
import { PRIORITY_LEVELS, TASK_SORT_FIELDS } from '#shared/constants/api'

import type {
  ApiCollectionResponse,
  ApiErrorResponse,
  ApiSuccessResponse,
  EnrichedTask,
  EnrichedTaskDetail,
  SubtaskMetadata,
  TaskGroupMetadata,
  TaskListMeta,
  TaskSubtaskSummary
} from '#shared/types'

type SortByValue = 'none' | 'task' | 'estimatedPoints' | 'deadline'

interface ParsedTaskRouteQuery {
  projectId: string
  sortBy: SortByValue
  sortOrder: 'asc' | 'desc'
  includeCompleted: boolean
  page: number
}

const PAGE_SIZE = 20

const route = useRoute()

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

const metadataForm = reactive<TaskGroupMetadata>({
  badge: null,
  completionBonusPoints: 0
})

// ── Expand/collapse grouped subtask state ────────────────────────────────────

const expandedTaskIds = ref<Set<string>>(new Set())
const detailsByTaskId = ref<Map<string, EnrichedTaskDetail>>(new Map())
const detailPendingIds = ref<Set<string>>(new Set())
const detailErrorIds = ref<Map<string, string>>(new Map())

// ── Subtask metadata editor ──────────────────────────────────────────────────

const subtaskEditorOpen = ref(false)
const editingSubtaskParentTaskId = ref<string | null>(null)
const editingSubtaskId = ref<string | null>(null)
const editingSubtask = ref<TaskSubtaskSummary | null>(null)

const subtaskForm = reactive<SubtaskMetadata>({
  priority: 'medium',
  difficulty: 1,
  timeEstimateMinutes: null
})

const savingSubtaskMetadata = ref(false)
const subtaskSaveError = ref('')

const priorityOptions = PRIORITY_LEVELS.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))

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

function parseRouteQuery(query: Record<string, unknown>): ParsedTaskRouteQuery {
  const sortBy = asQueryValue(query.sortBy)
  const sortOrder = asQueryValue(query.sortOrder)

  return {
    projectId: asQueryValue(query.projectId) ?? '',
    sortBy: sortBy && (TASK_SORT_FIELDS as readonly string[]).includes(sortBy)
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
  if (sortBy && (TASK_SORT_FIELDS as readonly string[]).includes(sortBy)) {
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
    void refreshList()
  }
)

async function syncRouteFromState() {
  if (!routeHydrated.value || applyingRouteQuery.value) return

  const currentQuery = normalizeRouteQuery(route.query)
  const nextQuery = buildRouteQueryFromState()

  if (JSON.stringify(currentQuery) === JSON.stringify(nextQuery)) {
    return
  }

  await navigateTo({ path: route.path, query: nextQuery }, { replace: true })
}

async function onListControlsChanged() {
  await nextTick()

  if (currentPage.value !== 1) {
    currentPage.value = 1
  }

  await syncRouteFromState()
  await refreshList()
}

const listQuery = computed(() => ({
  projectId: selectedProjectId.value || undefined,
  sortBy: selectedSortBy.value === 'none' ? undefined : selectedSortBy.value,
  sortOrder: selectedSortBy.value === 'none' ? undefined : selectedSortOrder.value,
  includeCompleted: includeCompleted.value,
  page: currentPage.value,
  pageSize: PAGE_SIZE
}))

type TaskListResponse = ApiCollectionResponse<EnrichedTask, TaskListMeta>

const listEnvelope = ref<TaskListResponse | null>(null)
const listPending = ref(false)
const listError = ref<Error | null>(null)
const syncPending = ref(false)
const syncError = ref('')

async function refreshList() {
  listPending.value = true
  listError.value = null

  try {
    listEnvelope.value = await $fetch<TaskListResponse>('/api/tasks', {
      credentials: 'include',
      query: listQuery.value
    })
  } catch (fetchError: unknown) {
    listError.value = new Error(parseApiErrorMessage(fetchError, 'Could not load tasks'))
  } finally {
    listPending.value = false
  }
}

async function resyncFromTodoist() {
  syncPending.value = true
  syncError.value = ''

  try {
    await $fetch('/api/todoist/sync', {
      method: 'POST',
      credentials: 'include'
    })

    await refreshList()
  } catch (fetchError: unknown) {
    syncError.value = parseApiErrorMessage(fetchError, 'Could not sync Todoist data')
  } finally {
    syncPending.value = false
  }
}

await refreshList()

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

async function goToPage(page: number) {
  const nextPage = Math.max(1, Math.min(page, totalPages.value))

  if (nextPage === currentPage.value) {
    return
  }

  currentPage.value = nextPage

  await syncRouteFromState()
  await refreshList()
}

// ── Inline expand/collapse helpers ──────────────────────────────────────────

async function loadDetailForTask(taskId: string) {
  if (detailsByTaskId.value.has(taskId)) return

  detailPendingIds.value = new Set([...detailPendingIds.value, taskId])
  detailErrorIds.value.delete(taskId)

  try {
    const response = await $fetch<ApiSuccessResponse<EnrichedTaskDetail>>(`/api/tasks/${taskId}`, {
      credentials: 'include'
    })

    const next = new Map(detailsByTaskId.value)
    next.set(taskId, response.data)
    detailsByTaskId.value = next
  } catch (fetchError: unknown) {
    const next = new Map(detailErrorIds.value)
    next.set(taskId, parseApiErrorMessage(fetchError, 'Could not load subtasks'))
    detailErrorIds.value = next
  } finally {
    const next = new Set(detailPendingIds.value)
    next.delete(taskId)
    detailPendingIds.value = next
  }
}

async function toggleExpand(task: EnrichedTask) {
  const id = task.id

  if (expandedTaskIds.value.has(id)) {
    const next = new Set(expandedTaskIds.value)
    next.delete(id)
    expandedTaskIds.value = next
    return
  }

  const next = new Set(expandedTaskIds.value)
  next.add(id)
  expandedTaskIds.value = next

  await loadDetailForTask(id)
}

function retryDetailLoad(taskId: string) {
  const next = new Map(detailErrorIds.value)
  next.delete(taskId)
  detailErrorIds.value = next
  void loadDetailForTask(taskId)
}

// ── Subtask metadata editor helpers ─────────────────────────────────────────

function openSubtaskEditor(parentTaskId: string, subtask: TaskSubtaskSummary) {
  editingSubtaskParentTaskId.value = parentTaskId
  editingSubtaskId.value = subtask.id
  editingSubtask.value = subtask
  subtaskForm.priority = subtask.metadata.priority
  subtaskForm.difficulty = subtask.metadata.difficulty
  subtaskForm.timeEstimateMinutes = subtask.metadata.timeEstimateMinutes
  subtaskSaveError.value = ''
  subtaskEditorOpen.value = true
}

function closeSubtaskEditor() {
  subtaskEditorOpen.value = false
  editingSubtaskParentTaskId.value = null
  editingSubtaskId.value = null
  editingSubtask.value = null
  subtaskSaveError.value = ''
}

async function saveSubtaskMetadata() {
  if (!editingSubtaskParentTaskId.value || !editingSubtaskId.value) return

  savingSubtaskMetadata.value = true
  subtaskSaveError.value = ''

  try {
    await $fetch(`/api/tasks/${editingSubtaskParentTaskId.value}/subtasks/${editingSubtaskId.value}/metadata`, {
      method: 'PATCH',
      credentials: 'include',
      body: {
        priority: subtaskForm.priority,
        difficulty: subtaskForm.difficulty,
        timeEstimateMinutes: subtaskForm.timeEstimateMinutes || null
      }
    })

    // Invalidate cached detail so it reloads with fresh points
    const next = new Map(detailsByTaskId.value)
    next.delete(editingSubtaskParentTaskId.value)
    detailsByTaskId.value = next

    // Reload detail and refresh list totals
    const parentId = editingSubtaskParentTaskId.value
    closeSubtaskEditor()
    await Promise.all([
      loadDetailForTask(parentId),
      refreshList()
    ])
  } catch (fetchError: unknown) {
    subtaskSaveError.value = parseApiErrorMessage(fetchError, 'Could not save subtask metadata')
  } finally {
    savingSubtaskMetadata.value = false
  }
}

function resetMetadataForm(metadata: TaskGroupMetadata) {
  metadataForm.badge = metadata.badge
  metadataForm.completionBonusPoints = metadata.completionBonusPoints
}

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
      const firstMessage = messages[0]
      if (firstMessage) {
        return field === '_root'
          ? firstMessage
          : `${field}: ${firstMessage}`
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
        badge: metadataForm.badge,
        completionBonusPoints: metadataForm.completionBonusPoints
      }
    })

    // Invalidate the inline-expanded detail cache so it shows fresh data
    const parentId = editingTaskId.value
    const next = new Map(detailsByTaskId.value)
    next.delete(parentId)
    detailsByTaskId.value = next
    if (expandedTaskIds.value.has(parentId)) {
      void loadDetailForTask(parentId)
    }

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

function deadlineColor(task: EnrichedTask) {
  if (!task.deadline) return 'neutral'
  return task.isDeadlineApproaching ? 'error' : 'primary'
}

const sortableColumns: Array<{ value: Exclude<SortByValue, 'none'>, label: string, align?: 'left' | 'right' }> = [
  { value: 'task', label: 'Task' },
  { value: 'estimatedPoints', label: 'Estimated points' },
  { value: 'deadline', label: 'Deadline' }
]

function sortIcon(sortBy: Exclude<SortByValue, 'none'>) {
  if (selectedSortBy.value !== sortBy) {
    return 'i-lucide-arrow-up-down'
  }

  return selectedSortOrder.value === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}

function sortButtonClass(sortBy: Exclude<SortByValue, 'none'>) {
  return selectedSortBy.value === sortBy ? 'text-highlighted' : 'text-toned hover:text-highlighted'
}

async function toggleColumnSort(sortBy: Exclude<SortByValue, 'none'>) {
  if (selectedSortBy.value === sortBy) {
    selectedSortOrder.value = selectedSortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    selectedSortBy.value = sortBy
    selectedSortOrder.value = 'asc'
  }

  currentPage.value = 1

  await refreshList()
}
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-2">
          <p class="text-xs font-semibold tracking-[0.2em] uppercase text-primary">
            Task planning
          </p>
          <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
            Tasks
          </h1>
        </div>

        <UButton
          label="Re-sync from Todoist"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="syncPending"
          :disabled="syncPending"
          @click="resyncFromTodoist"
        />
      </div>
      <p class="max-w-3xl text-base leading-7 text-toned">
        Browse synced Todoist work, tune metadata, and use estimated points plus progress signals to decide what to tackle next.
      </p>
    </section>

    <UAlert
      v-if="syncError"
      color="error"
      variant="subtle"
      title="Could not sync Todoist"
      :description="syncError"
    />

    <UCard class="border-default/70 bg-background/80 shadow-sm">
      <div class="grid gap-4 lg:grid-cols-[minmax(200px,1fr)_minmax(170px,220px)_minmax(170px,220px)_auto]">
        <UFormField label="Project">
          <select
            v-model="selectedProjectId"
            data-testid="tasks-project-filter"
            class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm"
            @change="onListControlsChanged"
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

        <UFormField label="Completed tasks">
          <div class="h-full flex items-end">
            <UCheckbox
              v-model="includeCompleted"
              data-testid="tasks-include-completed"
              label="Include completed"
              @update:model-value="onListControlsChanged"
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
          @click="() => refreshList()"
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
                <th
                  v-for="column in sortableColumns"
                  :key="column.value"
                  class="py-3 pr-4 font-medium"
                  :class="column.align === 'right' ? 'text-right' : ''"
                >
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 transition-colors"
                    :class="sortButtonClass(column.value)"
                    @click="toggleColumnSort(column.value)"
                  >
                    <span>{{ column.label }}</span>
                    <UIcon
                      :name="sortIcon(column.value)"
                      class="h-4 w-4"
                    />
                  </button>
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
              <template
                v-for="task in tasks"
                :key="task.id"
              >
                <!-- Parent group row -->
                <tr
                  class="border-b border-default/30 align-top"
                  :class="expandedTaskIds.has(task.id) ? 'bg-muted/10' : ''"
                  :data-testid="`task-row-${task.todoistTaskId}`"
                >
                  <td class="py-3 pr-4">
                    <div class="flex items-start gap-2">
                      <button
                        v-if="task.subtaskCount > 0"
                        type="button"
                        class="mt-0.5 shrink-0 text-toned hover:text-highlighted transition-colors"
                        :aria-label="expandedTaskIds.has(task.id) ? 'Collapse subtasks' : 'Expand subtasks'"
                        :data-testid="`task-expand-${task.todoistTaskId}`"
                        @click="toggleExpand(task)"
                      >
                        <UIcon
                          :name="expandedTaskIds.has(task.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                          class="h-4 w-4"
                        />
                      </button>
                      <span
                        v-else
                        class="mt-0.5 shrink-0 w-4 h-4"
                      />
                      <div>
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
                      </div>
                    </div>
                  </td>
                  <td class="py-3 pr-4">
                    <UBadge
                      v-if="task.metadata.badge"
                      color="primary"
                      variant="soft"
                    >
                      {{ task.metadata.badge }}
                    </UBadge>
                  </td>
                  <td class="py-3 pr-4">
                    <p
                      class="text-xl font-semibold text-primary leading-6"
                      :data-testid="`task-points-${task.todoistTaskId}`"
                    >
                      {{ task.estimatedPoints }}
                    </p>
                    <p
                      v-if="task.completionBonusPoints > 0"
                      class="text-xs text-toned"
                    >
                      +{{ task.completionBonusPoints }} bonus
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
                        {{ task.completedSubtaskCount }} / {{ task.subtaskCount }} subtasks
                      </p>
                      <p
                        v-else
                        class="text-xs text-toned"
                      >
                        Sync to track progress.
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

                <!-- Subtask rows (expanded) -->
                <template v-if="expandedTaskIds.has(task.id)">
                  <!-- Loading state -->
                  <tr v-if="detailPendingIds.has(task.id)">
                    <td
                      colspan="6"
                      class="py-3 pl-10 pr-4 text-sm text-toned border-b border-default/20 bg-muted/5"
                    >
                      <USkeleton class="h-5 w-1/3 rounded" />
                    </td>
                  </tr>

                  <!-- Error state -->
                  <tr v-else-if="detailErrorIds.has(task.id)">
                    <td
                      colspan="6"
                      class="py-3 pl-10 pr-4 border-b border-default/20 bg-muted/5"
                    >
                      <p class="text-sm text-error">
                        {{ detailErrorIds.get(task.id) }}
                      </p>
                      <UButton
                        label="Retry"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        class="mt-1"
                        @click="retryDetailLoad(task.id)"
                      />
                    </td>
                  </tr>

                  <!-- Subtask rows -->
                  <template v-else-if="detailsByTaskId.has(task.id)">
                    <tr
                      v-if="detailsByTaskId.get(task.id)!.subtasks.length === 0"
                    >
                      <td
                        colspan="6"
                        class="py-3 pl-10 pr-4 text-sm text-toned border-b border-default/20 bg-muted/5"
                      >
                        No subtasks synced yet.
                      </td>
                    </tr>
                    <tr
                      v-for="subtask in detailsByTaskId.get(task.id)!.subtasks"
                      :key="subtask.id"
                      class="border-b border-default/20 bg-muted/5 align-middle text-sm"
                    >
                      <td class="py-2 pl-10 pr-4">
                        <div class="flex items-center gap-2">
                          <UIcon
                            :name="subtask.isCompleted ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
                            class="h-4 w-4 shrink-0"
                            :class="subtask.isCompleted ? 'text-success' : 'text-toned'"
                          />
                          <span :class="subtask.isCompleted ? 'line-through text-toned' : 'text-highlighted'">
                            {{ subtask.title }}
                          </span>
                        </div>
                      </td>
                      <td class="py-2 pr-4">
                        <UBadge
                          :color="subtask.metadata.priority === 'high' ? 'error' : subtask.metadata.priority === 'medium' ? 'warning' : 'neutral'"
                          variant="subtle"
                          size="xs"
                        >
                          {{ subtask.metadata.priority }}
                        </UBadge>
                      </td>
                      <td class="py-2 pr-4">
                        <span class="font-semibold text-primary">{{ subtask.estimatedPoints }}</span>
                        <span class="text-toned ml-1">pts</span>
                      </td>
                      <td class="py-2 pr-4 text-toned">
                        D{{ subtask.metadata.difficulty }}
                        <span v-if="subtask.metadata.timeEstimateMinutes">
                          · {{ subtask.metadata.timeEstimateMinutes }}m
                        </span>
                      </td>
                      <td class="py-2 pr-4" />
                      <td class="py-2 text-right">
                        <UButton
                          label="Edit"
                          icon="i-lucide-pencil"
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          @click="openSubtaskEditor(task.id, subtask)"
                        />
                      </td>
                    </tr>
                  </template>
                </template>
              </template>
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
                <div class="flex items-start justify-between gap-2">
                  <p class="font-semibold text-highlighted leading-6">
                    {{ task.title }}
                  </p>
                  <button
                    v-if="task.subtaskCount > 0"
                    type="button"
                    class="shrink-0 text-toned hover:text-highlighted transition-colors mt-0.5"
                    :aria-label="expandedTaskIds.has(task.id) ? 'Collapse subtasks' : 'Expand subtasks'"
                    @click="toggleExpand(task)"
                  >
                    <UIcon
                      :name="expandedTaskIds.has(task.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      class="h-5 w-5"
                    />
                  </button>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ task.projectName ?? 'No project' }}
                  </UBadge>
                  <UBadge
                    v-if="task.metadata.badge"
                    color="primary"
                    variant="soft"
                  >
                    {{ task.metadata.badge }}
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
                    Estimated points
                  </dt>
                  <dd class="mt-1 text-xl font-semibold text-primary">
                    {{ task.estimatedPoints }}
                    <span
                      v-if="task.completionBonusPoints > 0"
                      class="text-sm font-normal text-toned"
                    >+{{ task.completionBonusPoints }} bonus</span>
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
                    <span
                      v-if="task.eligibleForProgressTracking"
                      class="text-sm font-normal text-toned"
                    >
                      ({{ task.completedSubtaskCount }}/{{ task.subtaskCount }})
                    </span>
                  </dd>
                </div>
              </dl>

              <!-- Expanded subtask list (mobile) -->
              <div v-if="expandedTaskIds.has(task.id)">
                <p
                  v-if="detailPendingIds.has(task.id)"
                  class="text-sm text-toned"
                >
                  Loading subtasks…
                </p>
                <p
                  v-else-if="detailErrorIds.has(task.id)"
                  class="text-sm text-error"
                >
                  {{ detailErrorIds.get(task.id) }}
                </p>
                <div
                  v-else-if="detailsByTaskId.has(task.id)"
                  class="space-y-2 rounded-xl border border-default/60 bg-background/70 p-3"
                >
                  <p
                    v-if="detailsByTaskId.get(task.id)!.subtasks.length === 0"
                    class="text-sm text-toned"
                  >
                    No subtasks synced yet.
                  </p>
                  <div
                    v-for="subtask in detailsByTaskId.get(task.id)!.subtasks"
                    :key="subtask.id"
                    class="flex items-center justify-between gap-2 text-sm"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <UIcon
                        :name="subtask.isCompleted ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
                        class="h-4 w-4 shrink-0"
                        :class="subtask.isCompleted ? 'text-success' : 'text-toned'"
                      />
                      <span
                        class="truncate"
                        :class="subtask.isCompleted ? 'line-through text-toned' : 'text-highlighted'"
                      >{{ subtask.title }}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="font-semibold text-primary text-xs">{{ subtask.estimatedPoints }}pts</span>
                      <UButton
                        icon="i-lucide-pencil"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        @click="openSubtaskEditor(task.id, subtask)"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <UButton
                label="Edit task settings"
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
                label="Completion bonus points"
                class="sm:col-span-2"
              >
                <UInput
                  v-model.number="metadataForm.completionBonusPoints"
                  data-testid="metadata-bonus-points"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                />
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

    <!-- Subtask settings modal -->
    <UModal
      v-model:open="subtaskEditorOpen"
      title="Subtask settings"
      :dismissible="!savingSubtaskMetadata"
      @update:open="(isOpen) => { if (!isOpen) closeSubtaskEditor() }"
    >
      <template #body>
        <div class="space-y-5">
          <div
            v-if="editingSubtask"
            class="rounded-2xl border border-default/70 bg-muted/20 p-4"
          >
            <p class="font-semibold text-highlighted">
              {{ editingSubtask.title }}
            </p>
            <p class="text-sm text-toned mt-1">
              Current reward: <span class="font-semibold text-primary">{{ editingSubtask.estimatedPoints }} pts</span>
            </p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Priority">
              <select
                v-model="subtaskForm.priority"
                class="w-full rounded-md border border-default bg-background px-3 py-2 text-sm"
              >
                <option
                  v-for="opt in priorityOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </UFormField>

            <UFormField
              label="Difficulty"
              hint="1–10"
            >
              <UInput
                v-model.number="subtaskForm.difficulty"
                type="number"
                min="1"
                max="10"
                step="1"
              />
            </UFormField>

            <UFormField
              label="Time estimate (minutes)"
              class="sm:col-span-2"
              hint="Optional"
            >
              <UInput
                :model-value="subtaskForm.timeEstimateMinutes !== null ? String(subtaskForm.timeEstimateMinutes) : ''"
                type="number"
                min="1"
                placeholder="Leave blank to skip"
                @update:model-value="(v) => subtaskForm.timeEstimateMinutes = (v === '' || v === null || v === undefined) ? null : Number(v)"
              />
            </UFormField>
          </div>

          <UAlert
            v-if="subtaskSaveError"
            color="error"
            variant="subtle"
            :title="subtaskSaveError"
          />

          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="savingSubtaskMetadata"
              @click="closeSubtaskEditor"
            />
            <UButton
              label="Save subtask settings"
              :loading="savingSubtaskMetadata"
              :disabled="savingSubtaskMetadata"
              @click="saveSubtaskMetadata"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
