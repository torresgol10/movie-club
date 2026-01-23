
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'PLACEHOLDER_KEY';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMovie {
    id: number;
    title: string;
    overview: string;
    release_date: string;
    poster_path: string | null;
}

export interface TMDBResponse {
    results: TMDBMovie[];
}

export async function searchMovies(query: string): Promise<TMDBMovie[]> {
    if (!query) return [];

    console.log(`Searching TMDB for: ${query}`);

    if (TMDB_API_KEY === 'PLACEHOLDER_KEY') {
        console.warn('TMDB_API_KEY is missing. Returning mock data.');
        // Return mock data if no key is present
        return [
            {
                id: 1,
                title: `Mock Movie: ${query}`,
                overview: 'This is a mock movie description because the API key is missing.',
                release_date: '2024-01-01',
                poster_path: null,
            },
        ];
    }

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`
        );

        if (!response.ok) {
            throw new Error(`TMDB API Error: ${response.statusText}`);
        }

        const data: TMDBResponse = await response.json();
        return data.results;
    } catch (error) {
        console.error('Failed to search movies:', error);
        return [];
    }
}
