import { handleFeedback } from '../src/lib/feedbackMail'

export function POST(request: Request): Promise<Response> {
  return handleFeedback(request, { apiKey: process.env.RESEND_API_KEY, send: fetch })
}
