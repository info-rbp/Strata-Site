import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess } from '../middleware/auth';

export const propertyRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

propertyRoutes.get('/properties', async (c) => {
  const user = requireCapability(c, 'property.read');
  const scoped = user.propertyScope
    ? await c.env.DB.prepare(`SELECT * FROM properties WHERE id = ?`).bind(user.propertyScope).all()
    : await c.env.DB.prepare(`SELECT * FROM properties ORDER BY name`).all();
  return c.json(scoped.results ?? []);
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
// pre-fill forms (report a problem, move booking, access device request)
// without asking the resident to know their own unit id.
propertyRoutes.get('/me/units', async (c) => {
  const user = requireCapability(c, 'property.read');
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
