const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { attachTier } = require('../middleware/subscription');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

router.use(attachTier);

// Validation helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Helper to generate slug from name
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * GET /api/projects
 * List all projects for the current user (with device count)
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .select('*, devices(count)')
      .order('created_at', { ascending: false });
    
    if (error) throw error;

    // Flatten device count from Supabase's nested format
    const projects = data.map(p => ({
      ...p,
      device_count: p.devices?.[0]?.count ?? 0,
      devices: undefined,
    }));
    
    res.json({ projects });
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * GET /api/projects/:id
 * Get a single project with device count
 */
router.get('/:id', 
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { data, error } = await req.supabase
        .from('projects')
        .select(`
          *,
          devices(count)
        `)
        .eq('id', req.params.id)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Project not found' });
        }
        throw error;
      }
      
      res.json({ project: data });
    } catch (err) {
      console.error('Error fetching project:', err);
      res.status(500).json({ error: 'Failed to fetch project' });
    }
  }
);

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/',
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('slug').optional().isString().trim().isLength({ min: 1, max: 50 }),
  body('description').optional().isString().trim(),
  body('icon').optional().isString().trim().isLength({ max: 4 }),
  body('category').optional().isString().trim().isLength({ max: 50 }),
  body('project_type').optional().isIn(['normal', 'batch']),
  validate,
  async (req, res) => {
    try {
      const { name, description, icon, category, project_type } = req.body;
      const slug = req.body.slug || generateSlug(name);

	// ─── Tier enforcement ───
      const projectType = project_type || 'normal';

      // Check if project type is allowed
      if (!req.limits.allowed_project_types.includes(projectType)) {
        return res.status(403).json({
          error: `Batch projects require a paid subscription`,
          tier: req.tier,
        });
      }

      // Check project count limit
      const { count: projectCount } = await req.supabase
        .from('projects')
        .select('*', { count: 'exact', head: true });

      if (req.limits.max_projects !== Infinity && projectCount >= req.limits.max_projects) {
        return res.status(403).json({
          error: `Free tier is limited to ${req.limits.max_projects} projects. Upgrade to create more.`,
          tier: req.tier,
          limit: req.limits.max_projects,
          current: projectCount,
        });
      }
      
      const { data, error } = await req.supabase
        .from('projects')
        .insert({
          user_id: req.user.id,
          name,
          slug,
          description,
          icon: icon || (project_type === 'batch' ? '🧪' : '📡'),
          category: category || (project_type === 'batch' ? 'Batch Testing' : 'General'),
          project_type: project_type || 'normal',
        })
        .select()
        .single();
      
      if (error) {
        // Handle duplicate slug
        if (error.code === '23505') {
          return res.status(409).json({ 
            error: 'A project with this slug already exists',
          });
        }
        throw error;
      }
      
      res.status(201).json({ project: data });
    } catch (err) {
      console.error('Error creating project:', err);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

/**
 * PATCH /api/projects/:id
 * Update a project
 */
router.patch('/:id',
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('slug').optional().isString().trim().isLength({ min: 1, max: 50 }),
  body('description').optional().isString().trim(),
  body('icon').optional().isString().trim().isLength({ max: 4 }),
  body('category').optional().isString().trim().isLength({ max: 50 }),
  validate,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.slug) updates.slug = req.body.slug;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.icon) updates.icon = req.body.icon;
      if (req.body.category) updates.category = req.body.category;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      
      const { data, error } = await req.supabase
        .from('projects')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Project not found' });
        }
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Slug already exists' });
        }
        throw error;
      }
      
      res.json({ project: data });
    } catch (err) {
      console.error('Error updating project:', err);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

/**
 * DELETE /api/projects/:id
 * Delete a project (cascades to devices and channels)
 */
router.delete('/:id',
  param('id').isUUID(),
  validate,
  async (req, res) => {
    try {
      const { error } = await req.supabase
        .from('projects')
        .delete()
        .eq('id', req.params.id);
      
      if (error) throw error;
      
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting project:', err);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

module.exports = router;
