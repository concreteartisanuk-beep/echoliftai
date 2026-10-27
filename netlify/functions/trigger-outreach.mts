export default async () => {
  console.log('🛑 Trigger outreach: execution blocked because outreach is PAUSED.')

  return Response.json({
    success: true,
    paused: true,
    smsSent: 0,
    message: 'ApexVoice prospect outreach is paused by owner request to eliminate Twilio charges.'
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  })
}
