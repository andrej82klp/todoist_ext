import { sendRedirect } from 'h3'

import { defineApiHandler } from '../../../utils/api'
import { issueTodoistOauthState } from '../../../utils/oauth-state'
import { buildTodoistAuthorizeUrl } from '../../../services/todoist/oauth'

export default defineApiHandler((event) => {
  const state = issueTodoistOauthState(event)

  return sendRedirect(event, buildTodoistAuthorizeUrl(state), 302)
})
