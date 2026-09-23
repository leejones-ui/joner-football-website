// Authorisation policy only. The caller must supply a server-verified identity;
// never populate this principal from request JSON, query parameters or headers.
// Account provisioning and authentication-provider integration are pending.
export function canReadJfpFinance(principal) {
  return principal?.verified === true && principal?.active === true &&
    ['owner', 'finance-admin'].includes(principal.role);
}

export function coachHoursView(principal, sessions) {
  if (principal?.verified !== true || principal?.active !== true ||
      principal.role !== 'coach' || typeof principal.coachId !== 'string' || !principal.coachId) {
    throw new Error('Forbidden');
  }
  // Field allowlist: never expose payments, other coaches, players or notes.
  return sessions.filter(session => session.coachId === principal.coachId).map(session => ({
    id: session.id,
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    location: session.location,
    status: session.status,
    scheduledMinutes: session.scheduledMinutes,
    approvedWorkedMinutes: session.approvedWorkedMinutes ?? null,
  }));
}
