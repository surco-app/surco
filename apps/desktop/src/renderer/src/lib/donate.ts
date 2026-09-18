// PayPal hosted donate button (no backend needed); target=_blank routes through
// the window-open handler, which hands the URL to the system browser. Lives here
// (not in a component) so the Stats tab and the donate nudge share one source.
export const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=2WXQ5XRQTPA5S'

// PayPal.me sends money friend-to-friend, so no fee is taken and the whole amount
// arrives; users asked for it as an alternative to the hosted donate button.
export const PAYPAL_ME_URL = 'https://paypal.me/vicentgozalbes'
export const PAYPAL_ME_LABEL = 'paypal.me/vicentgozalbes'
