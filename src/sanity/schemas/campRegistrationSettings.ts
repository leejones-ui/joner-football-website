export default {
  name: 'campRegistrationSettings',
  title: 'Camp Registration Settings',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', initialValue: 'Camp Registration Settings' },
    { name: 'introCopy', title: 'Form Intro Copy', type: 'text', rows: 3, initialValue: 'Complete the form below and submit payment to secure your place. Your spot is not confirmed until payment is complete.' },
    { name: 'defaultNotificationEmail', title: 'Default Notification Email', type: 'string', initialValue: 'leejones@jonerfootball.com' },
    { name: 'googleSheetName', title: 'Google Sheet Name', type: 'string' },
    { name: 'termsLabel', title: 'Agreement Checkbox Text', type: 'string', initialValue: 'I have read and agree to the website training agreement' },
    { name: 'successMessage', title: 'Success Message', type: 'text', rows: 3, initialValue: 'Registration received. Please complete payment to secure your place.' },
  ],
}
