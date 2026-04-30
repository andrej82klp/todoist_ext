import { defineApiHandler, action } from '../../../utils/api'

export default defineApiHandler(() => {
  return action(true, 'Contract action executed')
})
