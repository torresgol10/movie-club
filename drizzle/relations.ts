import { relations } from "drizzle-orm/relations";
import { users, movies, vettingResponses, votes } from "./schema";

export const moviesRelations = relations(movies, ({one, many}) => ({
	user: one(users, {
		fields: [movies.proposedBy],
		references: [users.id]
	}),
	vettingResponses: many(vettingResponses),
	votes: many(votes),
}));

export const usersRelations = relations(users, ({many}) => ({
	movies: many(movies),
	vettingResponses: many(vettingResponses),
	votes: many(votes),
}));

export const vettingResponsesRelations = relations(vettingResponses, ({one}) => ({
	user: one(users, {
		fields: [vettingResponses.userId],
		references: [users.id]
	}),
	movie: one(movies, {
		fields: [vettingResponses.movieId],
		references: [movies.id]
	}),
}));

export const votesRelations = relations(votes, ({one}) => ({
	user: one(users, {
		fields: [votes.userId],
		references: [users.id]
	}),
	movie: one(movies, {
		fields: [votes.movieId],
		references: [movies.id]
	}),
}));