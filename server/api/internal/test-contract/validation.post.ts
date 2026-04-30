import { taskMetadataUpdateSchema } from '../../../../shared/schemas'
import { defineApiHandler, success } from '../../../utils/api'
import { parseBodyWithSchema } from '../../../utils/validation'

export default defineApiHandler(async event => {
  const payload = await parseBodyWithSchema(event, taskMetadataUpdateSchema)

  return success(payload)
})
