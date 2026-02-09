import { sqliteTable, AnySQLiteColumn, text, foreignKey, integer } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const appState = sqliteTable("app_state", {
	key: text().primaryKey().notNull(),
	value: text(),
});

export const movies = sqliteTable("movies", {
	id: text().primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	year: integer(),
	coverUrl: text("cover_url"),
	proposedBy: text("proposed_by").references(() => users.id),
	status: text().default("PROPOSED"),
	weekNumber: integer("week_number"),
	createdAt: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`),
	vettingStartDate: integer("vetting_start_date"),
});

export const users = sqliteTable("users", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	pin: text().notNull(),
	createdAt: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

export const vettingResponses = sqliteTable("vetting_responses", {
	id: text().primaryKey().notNull(),
	movieId: text("movie_id").references(() => movies.id),
	userId: text("user_id").references(() => users.id),
	response: text(),
	createdAt: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

export const votes = sqliteTable("votes", {
	id: text().primaryKey().notNull(),
	movieId: text("movie_id").references(() => movies.id),
	userId: text("user_id").references(() => users.id),
	score: integer(),
	comment: text(),
	createdAt: integer("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

