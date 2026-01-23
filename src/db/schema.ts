import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Users table
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    pin: text('pin').notNull(), // Simple numeric PIN
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// Movies table
export const movies = sqliteTable('movies', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    year: integer('year'),
    coverUrl: text('cover_url'),

    // Who proposed it directly or essentially who owns this slot
    proposedBy: text('proposed_by').references(() => users.id),

    // Status: PROPOSED (in batch), ACTIVE (current week), WATCHED, REJECTED
    status: text('status').default('PROPOSED'),

    weekNumber: integer('week_number'), // Assigned during scheduling

    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// Votes table
export const votes = sqliteTable('votes', {
    id: text('id').primaryKey(),
    movieId: text('movie_id').references(() => movies.id),
    userId: text('user_id').references(() => users.id),
    score: integer('score'), // 0-10
    comment: text('comment'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// App State (to track current phase of the batch)
export const appState = sqliteTable('app_state', {
    key: text('key').primaryKey(), // 'current_phase', 'current_week'
    value: text('value'),
});

// Vetting Responses
export const vettingResponses = sqliteTable('vetting_responses', {
    id: text('id').primaryKey(),
    movieId: text('movie_id').references(() => movies.id),
    userId: text('user_id').references(() => users.id),
    response: text('response'), // 'SEEN', 'NOT_SEEN'
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});
