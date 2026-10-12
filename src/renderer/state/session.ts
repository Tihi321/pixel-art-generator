// The single app-wide EditorSession: the live document, its undo history, active layer/frame, selection,
// colours and onion skin. UI components edit it only through session.execute(command) / transactions,
// and the LLM tool bridge drives the very same object, so both share one undo history.

import { EditorSession } from '../../tools/session'

export const session = new EditorSession()
