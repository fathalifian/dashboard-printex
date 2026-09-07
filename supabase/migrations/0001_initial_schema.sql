-- 0001_initial_schema.sql
-- Based on Printex Order Monitoring System Database Design

-- Enable UUID extension if not enabled (Supabase usually has this enabled by default, but good practice)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: profiles
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table: customers
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  normalized_phone text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_name ON customers USING gin (to_tsvector('simple', name));
CREATE INDEX idx_customers_phone ON customers(normalized_phone);

-- Table: production_steps
CREATE TABLE production_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sequence integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  color_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: machines
CREATE TABLE machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  production_type text,
  is_active boolean NOT NULL DEFAULT true,
  speed_meter_per_hour numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: orders
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spk_code text NOT NULL UNIQUE,
  external_transaction_code text,
  customer_id uuid REFERENCES customers(id),

  production_type text NOT NULL, -- sublim / dtf / umbul-umbul / batik / jersey
  meter numeric(10,2) NOT NULL DEFAULT 0,

  customer_type text NOT NULL DEFAULT 'regular', -- regular / priority
  order_state text NOT NULL DEFAULT 'active',
  current_step_id uuid,

  order_date date NOT NULL,
  due_at date,
  started_at timestamptz,
  completed_at timestamptz,

  notes text,
  source text DEFAULT 'manual', -- manual / csv / whatsapp / integration
  created_by uuid REFERENCES profiles(id),
  assigned_designer_id uuid REFERENCES profiles(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_spk ON orders(spk_code);
CREATE INDEX idx_orders_due ON orders(due_at);
CREATE INDEX idx_orders_state ON orders(order_state);
CREATE INDEX idx_orders_current_step ON orders(current_step_id);

-- Table: order_step_events
CREATE TABLE order_step_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES production_steps(id),
  state text NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  note text,
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, step_id)
);

-- Table: order_activities
CREATE TABLE order_activities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text NOT NULL,
  actor_id uuid REFERENCES profiles(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_order_time ON order_activities(order_id, created_at desc);

-- Table: production_schedules
CREATE TABLE production_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft/approved/in_progress/completed
  generated_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  algorithm_version text,
  notes text
);

-- Table: schedule_items
CREATE TABLE schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES production_schedules(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  machine_id uuid REFERENCES machines(id),
  sequence integer NOT NULL,
  planned_start timestamptz,
  planned_end timestamptz,
  setup_minutes integer NOT NULL DEFAULT 0,
  reason text,
  is_manual_override boolean NOT NULL DEFAULT false,
  UNIQUE(schedule_id, order_id)
);

-- Seed Initial Data for production_steps
INSERT INTO production_steps (code, name, sequence, color_token) VALUES
  ('ORDER_IN', 'Order Masuk', 1, 'slate'),
  ('DESIGN', 'Proses Design', 2, 'red'),
  ('DESIGN_DONE', 'Design Done', 3, 'blue'),
  ('PRINTING', 'Proses Cetak', 4, 'amber'),
  ('DONE', 'Done', 5, 'emerald'),
  ('ARCHIVE', 'Arsip', 6, 'slate')
ON CONFLICT (code) DO NOTHING;
