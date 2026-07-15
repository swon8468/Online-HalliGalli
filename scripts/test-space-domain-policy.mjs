import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { emailUsesInstitutionDomain, normalizeInstitutionEmailDomain } from '../src/lib/emailDomain.ts'

const [migration, edge, spacesPage, spacesClient, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/202607150001_space_email_domain_and_manager.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/space-admin/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/Spaces.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/spaces.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(migration, /add column if not exists allowed_email_domain text/)
assert.match(migration, /split_part\(requester_email, '@', 2\)/)
assert.match(migration, /space_email_domain_required/)
assert.match(edge, /managerEmail[\s\S]*managerNickname[\s\S]*managerPassword/)
assert.match(edge, /app_metadata: \{ platform_role: 'player' \}/)
assert.match(edge, /role: 'manager'/)
assert.match(edge, /emailMatchesDomain\(email, space\.allowed_email_domain\)/)
assert.match(edge, /const domain = value\.trim\(\)\.toLowerCase\(\)/)
assert.doesNotMatch(edge, /replace\(\/\^@\+\//)
assert.match(edge, /bulk_validation_failed/)
assert.match(edge, /previousByUserId/)
assert.match(edge, /results\.reverse\(\)/)
assert.match(edge, /rollbackAccount/)
assert.match(edge, /bulk_operation_failed/)
assert.match(spacesPage, /기관 이메일 도메인/)
assert.match(spacesPage, /별도 스페이스 관리자/)
assert.match(spacesPage, /스페이스와 관리자 생성/)
assert.match(spacesClient, /space_email_domain_required/)
assert.match(styles, /\.admin-profile\{[^}]*color:#fff[^}]*background:transparent/)
assert.match(styles, /\.admin-profile \.avatar\{[^}]*background:#0b4f91/)

assert.equal(normalizeInstitutionEmailDomain('@swonport.kr'), '@swonport.kr')
assert.equal(normalizeInstitutionEmailDomain(' @SWONPORT.KR '), '@swonport.kr')
assert.equal(normalizeInstitutionEmailDomain('swonport.kr'), '')
assert.equal(normalizeInstitutionEmailDomain('@@swonport.kr'), '')
assert.equal(normalizeInstitutionEmailDomain('@swonport'), '')
assert.equal(normalizeInstitutionEmailDomain('@student.swonport.kr'), '@student.swonport.kr')
assert.equal(emailUsesInstitutionDomain('manager@swonport.kr', '@swonport.kr'), true)
assert.equal(emailUsesInstitutionDomain('MANAGER@SWONPORT.KR', '@swonport.kr'), true)
assert.equal(emailUsesInstitutionDomain('manager@sub.swonport.kr', '@swonport.kr'), false)
assert.equal(emailUsesInstitutionDomain('manager@fake-swonport.kr', '@swonport.kr'), false)
assert.equal(emailUsesInstitutionDomain('manager@@swonport.kr', '@swonport.kr'), false)
assert.equal(emailUsesInstitutionDomain('manager name@swonport.kr', '@swonport.kr'), false)

console.log('verified institution email-domain enforcement, separate space-manager creation, credential handoff, and dark admin profile styling')
