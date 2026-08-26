import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, requireAuth, assertPropertyAccess } from '../middleware/auth';

export const propertyRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

propertyRoutes.get('/properties', async (c) => {
  const user = requireCapability(c, 'property.read');
  const scoped = user.propertyScope
    ? await c.env.DB.prepare(`SELECT * FROM properties WHERE id = ?`).bind(user.propertyScope).all()
    : await c.env.DB.prepare(`SELECT * FROM properties ORDER BY name`).all();
  return c.json(scoped.results ?? []);
});

// Safe, property-scoped operating rules are used by resident, contractor and
// Building Manager forms. They contain no security codes or private contacts.
propertyRoutes.get('/properties/:id/operating-settings', async (c) => {
  const user = requireAuth(c);
  const propertyId = c.req.param('id');
  assertPropertyAccess(user, propertyId);
  const [property, settings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, address, timezone, strata_plan as strataPlan FROM properties WHERE id = ?`,
    ).bind(propertyId).first(),
    c.env.DB.prepare(
      `SELECT move_notice_hours as moveNoticeHours,
              move_weekdays_only as moveWeekdaysOnly,
              move_start_time as moveStartTime,
              move_end_time as moveEndTime,
              maximum_vehicle_height_mm as maximumVehicleHeightMm,
              move_access_instructions as moveAccessInstructions,
              contractor_sign_in_instructions as contractorSignInInstructions,
              updated_at as updatedAt
       FROM property_operating_settings WHERE property_id = ?`,
    ).bind(propertyId).first(),
  ]);
  if (!property) return c.json({ error: { code: 'NOT_FOUND', message: 'Property not found.' } }, 404);
  return c.json({ property, settings: settings ?? {} });
});

propertyRoutes.get('/properties/:id/units', async (c) => {
  const user = requireCapability(c, 'property.read');
  const propertyId = c.req.param('id');
  assertPropertyAccess(user, propertyId);
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, 
       (SELECT p.full_name FROM occupancies o JOIN people p ON p.id = o.person_id
        WHERE o.unit_id = u.id AND o.is_current = 1 AND o.occupancy_role = 'owner' LIMIT 1) as ownerName,
       (SELECT p.full_name FROM occupancies o JOIN people p ON p.id = o.person_id
        WHERE o.unit_id = u.id AND o.is_current = 1 AND o.occupancy_role = 'tenant' LIMIT 1) as tenantName
     FROM units u WHERE u.property_id = ? ORDER BY u.unit_number`,
  )
    .bind(propertyId)
    .all();
  return c.json(results ?? []);
});

propertyRoutes.get('/properties/:id/locations', async (c) => {
  const user = requireCapability(c, 'property.read');
  const propertyId = c.req.param('id');
  assertPropertyAccess(user, propertyId);
  const { results } = await c.env.DB.prepare(`SELECT * FROM locations WHERE property_id = ? ORDER BY name`)
    .bind(propertyId)
    .all();
  return c.json(results ?? []);
});

// Resident convenience endpoint: returns the unit(s) the current user
// occupies (owner/tenant/authorised_agent), used by the resident portal to
// pre-fill forms without exposing the rest of the unit register.
propertyRoutes.get('/me/units', async (c) => {
  const user = requireAuth(c);
  if (!user.personId) return c.json([]);
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, o.occupancy_role as occupancyRole FROM occupancies o
     JOIN units u ON u.id = o.unit_id
     WHERE o.person_id = ? AND o.is_current = 1`,
  )
    .bind(user.personId)
    .all();
  return c.json(results ?? []);
});

propertyRoutes.get('/units/:id', async (c) => {
  const user = requireCapability(c, 'property.read');
  const unit = await c.env.DB.prepare(`SELECT * FROM units WHERE id = ?`).bind(c.req.param('id')).first();
  if (!unit) return c.json({ error: { code: 'NOT_FOUND', message: 'Unit not found.' } }, 404);
  assertPropertyAccess(user, unit.property_id as string);
  const { results: occupancies } = await c.env.DB.prepare(
    `SELECT o.*, p.full_name as personName, p.email as personEmail, p.phone as personPhone
     FROM occupancies o JOIN people p ON p.id = o.person_id
     WHERE o.unit_id = ? ORDER BY o.is_current DESC, o.start_date DESC`,
  )
    .bind(unit.id)
    .all();
  const { results: requests } = await c.env.DB.prepare(
    `SELECT * FROM resident_requests WHERE unit_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(unit.id)
    .all();
  return c.json({ unit, occupancies: occupancies ?? [], requests: requests ?? [] });
});
