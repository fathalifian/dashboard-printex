# Implementation Checklist

## Foundation

- [ ] Next.js + TypeScript project
- [ ] Tailwind configured
- [ ] Inter font
- [ ] Supabase project
- [ ] env variables
- [ ] auth client/server helpers

## Database

- [ ] profiles
- [ ] customers
- [ ] orders
- [ ] production_steps
- [ ] order_step_events
- [ ] order_activities
- [ ] invoices
- [ ] payments
- [ ] machines
- [ ] production_schedules
- [ ] schedule_items
- [ ] indexes
- [ ] RLS

## Auth & permissions

- [ ] login page
- [ ] role in profile
- [ ] page guards
- [ ] mutation guards
- [ ] RLS tested per role

## UI

- [ ] sidebar
- [ ] header
- [ ] KPI cards
- [ ] search
- [ ] filter chips
- [ ] orders table
- [ ] order detail
- [ ] production timeline
- [ ] activity list
- [ ] add/edit order form
- [ ] history
- [ ] finance
- [ ] schedule
- [ ] settings

## Order flows

- [ ] create
- [ ] edit
- [ ] advance step
- [ ] hold
- [ ] resume
- [ ] cancel
- [ ] complete
- [ ] activity written for all actions

## Search

- [ ] SPK
- [ ] customer name
- [ ] normalized WhatsApp
- [ ] active + completed

## Realtime

- [ ] order update reflected on another browser
- [ ] activity reflected
- [ ] schedule reflected
- [ ] finance reflected where authorized

## Scheduling

- [ ] eligible orders query
- [ ] overdue first
- [ ] urgent priority
- [ ] EDD
- [ ] paper grouping when safe
- [ ] setup separator/reason
- [ ] save draft schedule
- [ ] manual reorder
- [ ] approve schedule

## Import

- [ ] CSV upload
- [ ] mapping
- [ ] validation
- [ ] duplicate detection
- [ ] result summary

## QA

- [ ] unit tests
- [ ] integration tests
- [ ] E2E core flows
- [ ] UAT with actual staff
- [ ] 2-browser realtime test
- [ ] permission test
- [ ] due date timezone test

## Go-live

- [ ] production domain
- [ ] production users
- [ ] backup/export plan
- [ ] staff onboarding
- [ ] pilot period
- [ ] collect UAT feedback
- [ ] freeze/revise SOP
