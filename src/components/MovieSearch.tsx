'use client';

import { useState } from 'react';
import { searchMoviesAction } from '@/app/actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface MovieSearchProps {
    onSelect: (movie: any) => void;
}

export default function MovieSearch({ onSelect }: MovieSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            const movies = await searchMoviesAction(query);
            setResults(movies);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-md bg-card p-4 border-border">
            <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Search TMDB..."
                        className="pl-9 bg-background"
                    />
                </div>
                <Button
                    onClick={handleSearch}
                    disabled={loading}
                >
                    {loading ? '...' : 'Search'}
                </Button>
            </div>

            <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar">
                {results.map((movie) => (
                    <div
                        key={movie.id}
                        className="flex gap-4 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
                        onClick={() => onSelect(movie)}
                    >
                        {movie.poster_path ? (
                            <img
                                src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                                alt={movie.title}
                                className="w-[50px] h-[75px] object-cover rounded-sm shadow-sm"
                            />
                        ) : (
                            <div className="w-[50px] h-[75px] bg-muted/30 rounded-sm flex items-center justify-center text-xs text-muted-foreground border border-border">
                                No Img
                            </div>
                        )}
                        <div className="flex flex-col justify-center">
                            <div className="font-semibold text-foreground">{movie.title}</div>
                            <div className="text-xs text-muted-foreground">
                                {movie.release_date ? movie.release_date.split('-')[0] : 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                {movie.overview}
                            </div>
                        </div>
                    </div>
                ))}
                {results.length === 0 && !loading && query && (
                    <p className="text-sm text-center text-muted-foreground py-4">No results found</p>
                )}
            </div>
        </Card>
    );
}
