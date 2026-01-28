const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

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
 * List all projects for the current user
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ projects: data });
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
  validate,
  async (req, res) => {
    try {
      const { name, description } = req.body;
      const slug = req.body.slug || generateSlug(name);
      
      const { data, error } = await req.supabase
        .from('projects')
        .insert({
          user_id: req.user.id,
          name,
          slug,
          description,
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
  validate,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.slug) updates.slug = req.body.slug;
      if (req.body.description !== undefined) updates.description = req.body.description;
      
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
