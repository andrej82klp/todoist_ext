import { paginationQuerySchema } from '../../../shared/schemas'
import { ledgerRepository } from '../../repositories/ledger'
import { pointsEngineService } from '../../services/points/pointsEngineService'
import { defineApiHandler, success } from '../../utils/api'
import { requireCurrentUser } from '../../utils/session'
import { parseQueryWithSchema } from '../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const query = parseQueryWithSchema(event, paginationQuerySchema)

  const [rows, total, balanceRow] = await Promise.all([
    ledgerRepository.listByUserIdPaginated(user.id, query.page, query.pageSize),
    ledgerRepository.countByUserId(user.id),
    ledgerRepository.getBalanceByUserId(user.id)
  ])

  const transactions = rows.map(row => pointsEngineService.ledgerRowToDomain(row))

  return success({
    transactions,
    pointsSummary: pointsEngineService.balanceRowToSummary(balanceRow),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total
    }
  })
})
