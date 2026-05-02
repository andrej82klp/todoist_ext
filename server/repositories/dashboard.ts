import { and, desc, eq, isNull } from 'drizzle-orm'

import { getDb } from '../db/client'
import { dashboardNotifications } from '../db/schema'

export const dashboardRepository = {
  async listActiveNotificationsByUserId(userId: string, limit = 5) {
    const db = getDb()

    return db.select().from(dashboardNotifications)
      .where(and(
        eq(dashboardNotifications.userId, userId),
        isNull(dashboardNotifications.acknowledgedAt)
      ))
      .orderBy(desc(dashboardNotifications.createdAt))
      .limit(limit)
  },

  async findNotificationById(userId: string, notificationId: string) {
    const db = getDb()
    const [notification] = await db.select().from(dashboardNotifications)
      .where(and(
        eq(dashboardNotifications.userId, userId),
        eq(dashboardNotifications.id, notificationId)
      ))
      .limit(1)

    return notification ?? null
  },

  async acknowledgeNotification(userId: string, notificationId: string) {
    const existing = await dashboardRepository.findNotificationById(userId, notificationId)

    if (!existing) {
      return null
    }

    if (existing.acknowledgedAt) {
      return existing
    }

    const db = getDb()
    const [notification] = await db.update(dashboardNotifications)
      .set({
        acknowledgedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(dashboardNotifications.userId, userId),
        eq(dashboardNotifications.id, notificationId)
      ))
      .returning()

    return notification ?? null
  }
}
