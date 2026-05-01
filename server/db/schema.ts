import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const oauthProviderEnum = pgEnum('oauth_provider', ['todoist'])
export const todoistItemTypeEnum = pgEnum('todoist_item_type', ['project', 'task', 'subtask'])
export const priorityLevelEnum = pgEnum('priority_level', ['low', 'medium', 'high'])
export const ledgerTransactionTypeEnum = pgEnum('ledger_transaction_type', ['earned', 'spent', 'bonus', 'adjusted'])
export const streakBonusStrategyEnum = pgEnum('streak_bonus_strategy', ['fixed', 'percentage'])
export const streakRuleTypeEnum = pgEnum('streak_rule_type', ['completed_items', 'points'])
export const dashboardNotificationTypeEnum = pgEnum('dashboard_notification_type', ['streak_protection_used', 'system'])
export const dashboardNotificationSeverityEnum = pgEnum('dashboard_notification_severity', ['info', 'warning', 'critical'])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  todoistUserId: varchar('todoist_user_id', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  timezone: varchar('timezone', { length: 64 }),
  ...auditColumns()
}, table => [
  uniqueIndex('users_email_unique').on(table.email),
  uniqueIndex('users_todoist_user_id_unique').on(table.todoistUserId)
])

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum('provider').notNull().default('todoist'),
  providerUserId: varchar('provider_user_id', { length: 128 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  tokenType: varchar('token_type', { length: 32 }),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  ...auditColumns()
}, table => [
  uniqueIndex('oauth_accounts_provider_user_id_unique').on(table.provider, table.providerUserId),
  uniqueIndex('oauth_accounts_user_provider_unique').on(table.userId, table.provider),
  index('oauth_accounts_user_id_idx').on(table.userId)
])

export const todoistItemMappings = pgTable('todoist_item_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  todoistItemId: varchar('todoist_item_id', { length: 128 }).notNull(),
  itemType: todoistItemTypeEnum('item_type').notNull(),
  parentTodoistItemId: varchar('parent_todoist_item_id', { length: 128 }),
  projectTodoistId: varchar('project_todoist_id', { length: 128 }),
  title: text('title').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  isCompleted: boolean('is_completed').notNull().default(false),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...auditColumns()
}, table => [
  uniqueIndex('todoist_item_mappings_user_todoist_item_unique').on(table.userId, table.todoistItemId),
  index('todoist_item_mappings_user_item_type_idx').on(table.userId, table.itemType),
  index('todoist_item_mappings_project_idx').on(table.projectTodoistId)
])

export const taskMetadata = pgTable('task_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  todoistItemMappingId: uuid('todoist_item_mapping_id').notNull().references(() => todoistItemMappings.id, { onDelete: 'cascade' }),
  priority: priorityLevelEnum('priority').notNull().default('medium'),
  difficulty: integer('difficulty').notNull().default(1),
  timeEstimateMinutes: integer('time_estimate_minutes'),
  completionBonusEnabled: boolean('completion_bonus_enabled').notNull().default(true),
  completionBonusPercent: numeric('completion_bonus_percent', { precision: 5, scale: 2 }).notNull().default('10.00'),
  badge: varchar('badge', { length: 64 }),
  customPointOverride: integer('custom_point_override'),
  ...auditColumns()
}, table => [
  uniqueIndex('task_metadata_user_mapping_unique').on(table.userId, table.todoistItemMappingId),
  index('task_metadata_user_id_idx').on(table.userId),
  check('task_metadata_difficulty_check', sql`${table.difficulty} >= 1 and ${table.difficulty} <= 10`),
  check('task_metadata_time_estimate_check', sql`${table.timeEstimateMinutes} is null or ${table.timeEstimateMinutes} >= 0`),
  check('task_metadata_completion_bonus_percent_check', sql`${table.completionBonusPercent} >= 0`)
])

export const rewards = pgTable('rewards', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 64 }),
  costPoints: integer('cost_points').notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...auditColumns()
}, table => [
  index('rewards_user_archived_idx').on(table.userId, table.isArchived),
  check('rewards_cost_points_positive_check', sql`${table.costPoints} > 0`)
])

export const rewardRedemptions = pgTable('reward_redemptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rewardId: uuid('reward_id').notNull().references(() => rewards.id, { onDelete: 'cascade' }),
  costPoints: integer('cost_points').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  redemptionNote: text('redemption_note'),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  ...auditColumns()
}, table => [
  index('reward_redemptions_user_redeemed_at_idx').on(table.userId, table.redeemedAt),
  uniqueIndex('reward_redemptions_user_idempotency_key_unique').on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  check('reward_redemptions_cost_points_positive_check', sql`${table.costPoints} > 0`)
])

export const pointLedger = pgTable('point_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  transactionType: ledgerTransactionTypeEnum('transaction_type').notNull(),
  amount: integer('amount').notNull(),
  description: text('description').notNull(),
  source: varchar('source', { length: 64 }).notNull(),
  relatedEntityType: varchar('related_entity_type', { length: 64 }),
  relatedEntityId: varchar('related_entity_id', { length: 128 }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  ...auditColumns()
}, table => [
  index('point_ledger_user_created_at_idx').on(table.userId, table.createdAt),
  uniqueIndex('point_ledger_user_idempotency_key_unique').on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`),
  check('point_ledger_amount_non_zero_check', sql`${table.amount} <> 0`)
])

export const pointBalances = pgTable('point_balances', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  currentBalance: integer('current_balance').notNull().default(0),
  lifetimeEarned: integer('lifetime_earned').notNull().default(0),
  lifetimeSpent: integer('lifetime_spent').notNull().default(0),
  ...auditColumns()
}, table => [
  check('point_balances_lifetime_earned_check', sql`${table.lifetimeEarned} >= 0`),
  check('point_balances_lifetime_spent_check', sql`${table.lifetimeSpent} >= 0`)
])

export const streakState = pgTable('streak_state', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  lastQualifiedDate: date('last_qualified_date'),
  lastEvaluatedDate: date('last_evaluated_date'),
  lastProtectionUsedDate: date('last_protection_used_date'),
  ...auditColumns()
}, table => [
  check('streak_state_current_non_negative_check', sql`${table.currentStreak} >= 0`),
  check('streak_state_longest_non_negative_check', sql`${table.longestStreak} >= 0`)
])

export const streakHistory = pgTable('streak_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activityDate: date('activity_date').notNull(),
  qualified: boolean('qualified').notNull(),
  qualifiedBy: varchar('qualified_by', { length: 64 }),
  pointsEarned: integer('points_earned').notNull().default(0),
  completedCount: integer('completed_count').notNull().default(0),
  streakLength: integer('streak_length').notNull().default(0),
  protectionConsumed: boolean('protection_consumed').notNull().default(false),
  ...auditColumns()
}, table => [
  uniqueIndex('streak_history_user_activity_date_unique').on(table.userId, table.activityDate),
  index('streak_history_user_activity_date_idx').on(table.userId, table.activityDate),
  check('streak_history_points_earned_non_negative_check', sql`${table.pointsEarned} >= 0`),
  check('streak_history_completed_count_non_negative_check', sql`${table.completedCount} >= 0`),
  check('streak_history_streak_length_non_negative_check', sql`${table.streakLength} >= 0`)
])

export const streakProtection = pgTable('streak_protection', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(3),
  lastRewardedAt: timestamp('last_rewarded_at', { withTimezone: true }),
  ...auditColumns()
}, table => [
  check('streak_protection_balance_non_negative_check', sql`${table.balance} >= 0`)
])

export const milestoneDefinitions = pgTable('milestone_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  days: integer('days').notNull(),
  fixedBonusPoints: integer('fixed_bonus_points').notNull().default(0),
  percentageBonus: numeric('percentage_bonus', { precision: 5, scale: 2 }).notNull().default('0.00'),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns()
}, table => [
  uniqueIndex('milestone_definitions_user_days_unique').on(table.userId, table.days),
  index('milestone_definitions_user_active_idx').on(table.userId, table.isActive),
  check('milestone_definitions_days_positive_check', sql`${table.days} > 0`),
  check('milestone_definitions_fixed_bonus_non_negative_check', sql`${table.fixedBonusPoints} >= 0`),
  check('milestone_definitions_percentage_bonus_non_negative_check', sql`${table.percentageBonus} >= 0`)
])

export const milestoneAwards = pgTable('milestone_awards', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  milestoneDefinitionId: uuid('milestone_definition_id').notNull().references(() => milestoneDefinitions.id, { onDelete: 'cascade' }),
  awardedForDays: integer('awarded_for_days').notNull(),
  ledgerTransactionId: uuid('ledger_transaction_id').references(() => pointLedger.id, { onDelete: 'set null' }),
  awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  ...auditColumns()
}, table => [
  uniqueIndex('milestone_awards_user_definition_unique').on(table.userId, table.milestoneDefinitionId),
  check('milestone_awards_awarded_for_days_positive_check', sql`${table.awardedForDays} > 0`)
])

export const globalSettings = pgTable('global_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  difficultyMultiplierBase: integer('difficulty_multiplier_base').notNull().default(10),
  lowPriorityMultiplier: numeric('low_priority_multiplier', { precision: 5, scale: 2 }).notNull().default('1.00'),
  mediumPriorityMultiplier: numeric('medium_priority_multiplier', { precision: 5, scale: 2 }).notNull().default('1.25'),
  highPriorityMultiplier: numeric('high_priority_multiplier', { precision: 5, scale: 2 }).notNull().default('1.50'),
  completionBonusPercent: numeric('completion_bonus_percent', { precision: 5, scale: 2 }).notNull().default('10.00'),
  streakRuleType: streakRuleTypeEnum('streak_rule_type').notNull().default('completed_items'),
  streakRuleValue: integer('streak_rule_value').notNull().default(1),
  streakProtectionEnabled: boolean('streak_protection_enabled').notNull().default(true),
  streakProtectionStartingBalance: integer('streak_protection_starting_balance').notNull().default(3),
  protectionRewardEveryNDays: integer('protection_reward_every_n_days').notNull().default(10),
  protectionRewardAmount: integer('protection_reward_amount').notNull().default(1),
  milestoneBonusStrategy: streakBonusStrategyEnum('milestone_bonus_strategy').notNull().default('fixed'),
  milestonePercentageWindowDays: integer('milestone_percentage_window_days').notNull().default(5),
  ...auditColumns()
}, table => [
  check('global_settings_difficulty_multiplier_positive_check', sql`${table.difficultyMultiplierBase} > 0`),
  check('global_settings_low_priority_positive_check', sql`${table.lowPriorityMultiplier} > 0`),
  check('global_settings_medium_priority_positive_check', sql`${table.mediumPriorityMultiplier} > 0`),
  check('global_settings_high_priority_positive_check', sql`${table.highPriorityMultiplier} > 0`),
  check('global_settings_completion_bonus_non_negative_check', sql`${table.completionBonusPercent} >= 0`),
  check('global_settings_streak_rule_value_positive_check', sql`${table.streakRuleValue} > 0`),
  check('global_settings_streak_protection_starting_balance_non_negative_check', sql`${table.streakProtectionStartingBalance} >= 0`),
  check('global_settings_protection_reward_every_n_days_positive_check', sql`${table.protectionRewardEveryNDays} > 0`),
  check('global_settings_protection_reward_amount_non_negative_check', sql`${table.protectionRewardAmount} >= 0`),
  check('global_settings_milestone_percentage_window_days_positive_check', sql`${table.milestonePercentageWindowDays} > 0`)
])

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  deliveryKey: varchar('delivery_key', { length: 255 }).notNull(),
  eventKey: varchar('event_key', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('processed'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  ...auditColumns()
}, table => [
  uniqueIndex('webhook_deliveries_delivery_event_unique').on(table.deliveryKey, table.eventKey),
  index('webhook_deliveries_user_processed_idx').on(table.userId, table.processedAt)
])

export const dashboardNotifications = pgTable('dashboard_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notificationType: dashboardNotificationTypeEnum('notification_type').notNull(),
  severity: dashboardNotificationSeverityEnum('severity').notNull().default('info'),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  ...auditColumns()
}, table => [
  index('dashboard_notifications_user_acknowledged_idx').on(table.userId, table.acknowledgedAt),
  index('dashboard_notifications_user_created_at_idx').on(table.userId, table.createdAt)
])

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type GlobalSettings = typeof globalSettings.$inferSelect
export type NewGlobalSettings = typeof globalSettings.$inferInsert
export type Reward = typeof rewards.$inferSelect
export type PointLedgerTransaction = typeof pointLedger.$inferSelect
