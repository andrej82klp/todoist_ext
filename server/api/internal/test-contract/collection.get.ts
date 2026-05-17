import { defineApiHandler, collection } from '../../../utils/api'

export default defineApiHandler(() => {
  return collection(
    [
      { id: 'item_1', label: 'First' },
      { id: 'item_2', label: 'Second' }
    ],
    {
      page: 1,
      pageSize: 2,
      total: 2
    }
  )
})
