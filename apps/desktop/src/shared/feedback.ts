export interface FeedbackForm {
  email: string
  message: string
  attachReport: boolean
  error?: string
  stack?: string
}

export type FeedbackOutcome = 'sent' | 'failed'
