import { defineApiHandler, success } from '../../../utils/api'

export default defineApiHandler(() => {
  return success({
    kind: 'single',
    ok: true
  })
})
