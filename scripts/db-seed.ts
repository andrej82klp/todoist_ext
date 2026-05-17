import 'dotenv/config'

import { closeDbConnection } from '../server/db/client'
import { ensureUserDefaults } from '../server/db/defaults'
import { usersRepository } from '../server/repositories/users'

const seedEmail = process.env.SEED_USER_EMAIL ?? 'dev@todoist-companion.local'
const seedTodoistUserId = process.env.SEED_TODOIST_USER_ID ?? 'todoist-dev-user'
const seedDisplayName = process.env.SEED_USER_NAME ?? 'Dev User'
const seedTimezone = process.env.SEED_USER_TIMEZONE ?? 'UTC'

async function main() {
  const user = await usersRepository.upsertByTodoistUserId({
    email: seedEmail,
    todoistUserId: seedTodoistUserId,
    displayName: seedDisplayName,
    timezone: seedTimezone
  })

  const defaults = await ensureUserDefaults(user.id)

  console.log('Seeded user defaults')
  console.log(JSON.stringify({
    userId: user.id,
    email: user.email,
    milestoneDays: defaults.milestones.map(milestone => milestone.days)
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDbConnection()
  })
