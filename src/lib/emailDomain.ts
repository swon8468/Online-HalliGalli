const institutionDomainPattern = /^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function normalizeInstitutionEmailDomain(value: string) {
  const domain = value.trim().toLowerCase()
  return institutionDomainPattern.test(domain) ? domain : ''
}

export function emailUsesInstitutionDomain(value: string, domain: string) {
  const normalizedDomain = normalizeInstitutionEmailDomain(domain)
  const email = value.trim().toLowerCase()
  const parts = email.split('@')
  return Boolean(normalizedDomain && parts.length === 2 && parts[0] && !/\s/.test(parts[0]) && `@${parts[1]}` === normalizedDomain)
}
