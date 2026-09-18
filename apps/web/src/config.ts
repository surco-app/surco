// PayPal hosted donate button (3 preset amounts + custom, set in the PayPal
// dashboard). The desktop Stats tab points at the same button via its own constant.
export const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=2WXQ5XRQTPA5S'

// Google Analytics 4 measurement ID. Public by design (it ships in the page),
// so it lives in source rather than an env var.
export const GA_MEASUREMENT_ID = 'G-QWKNHNEBQE'

// PayPal.me sends money friend-to-friend, so no fee is taken and the whole amount
// arrives; users asked for it as an alternative to the hosted donate button.
export const PAYPAL_ME_URL = 'https://paypal.me/vicentgozalbes'
export const PAYPAL_ME_LABEL = 'paypal.me/vicentgozalbes'
