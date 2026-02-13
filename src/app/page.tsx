'use client';

import { useEffect, useState } from 'react';
import MovieSearch from '@/components/MovieSearch';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, LogOut } from "lucide-react";
import { useActionState } from 'react';
import { createUserAction, logoutAction } from './actions';
import { toast } from 'sonner';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [vettingMovie, setVettingMovie] = useState<any>(null);
  const [pendingVotes, setPendingVotes] = useState<any[]>([]);
  const [votedVotes, setVotedVotes] = useState<any[]>([]);
  const [hasVetted, setHasVetted] = useState(false);
  const [pendingVetters, setPendingVetters] = useState<any[]>([]);
  const [createState, createAction, isCreating] = useActionState(createUserAction, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (createState?.success) {
      setOpen(false);
      toast.success('User created successfully!');
    }
  }, [createState]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Poll every 30s for updates
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const res = await fetch('/api/movies');
      if (res.status === 401) window.location.href = '/login';
      const json = await res.json();
      setData(json);
      setLoading(false);

      // If in ACTIVE phase, fetch vetting movie and pending votes
      if (json.state.phase === 'ACTIVE') {
        // Fetch vetting movie
        const vettingRes = await fetch('/api/vetting');
        const vettingJson = await vettingRes.json();
        setVettingMovie(vettingJson.movie);
        setHasVetted(vettingJson.hasVetted || false);
        setPendingVetters(vettingJson.pendingUsers || []);

        // Fetch pending votes
        const votesRes = await fetch('/api/votes');
        const votesJson = await votesRes.json();
        setPendingVotes(votesJson.pendingVotes || []);
        setVotedVotes(votesJson.votedVotes || []);
      } else {
        setVettingMovie(null);
        setHasVetted(false);
        setPendingVetters([]);
        setPendingVotes([]);
        setVotedVotes([]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function submitVetting(seen: boolean) {
    if (seen && !confirm('Are you sure you have seen this? It will reject the movie.')) return;

    await fetch('/api/vetting', {
      method: 'POST',
      body: JSON.stringify({ seen }),
    });
    loadData();
  }

  function handleMovieSelect(movie: any) {
    console.log('Movie selected:', movie); // Debug log
    setTitle(movie.title);
    if (movie.poster_path) {
      setCover(`https://image.tmdb.org/t/p/original${movie.poster_path}`);
    }
  }

  async function submitMovie(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch('/api/movies', {
      method: 'POST',
      body: JSON.stringify({ title, coverUrl: cover }),
    });
    setTitle('');
    setCover('');
    setSubmitting(false);
    loadData();
  }

  async function submitVote(movieId: string, score: number) {
    await fetch('/api/votes', {
      method: 'POST',
      body: JSON.stringify({ movieId, score })
    });
    loadData();
    toast.success('Vote cast!');
  }

  if (loading || !data) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;

  const { state, mySubmission, stats } = data;

  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-8 min-h-screen pb-20">
      <header className="flex justify-between items-center py-6">
        <div className="flex items-center">
          <img src="/sala404.svg" alt="Sala 404" className="h-12 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add Member
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Member</DialogTitle>
                <DialogDescription>
                  Create a new user account for the movie club.
                </DialogDescription>
              </DialogHeader>
              <form action={createAction} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="username" className="text-right text-sm font-medium">
                    Username
                  </label>
                  <Input id="username" name="username" className="col-span-3" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="pin" className="text-right text-sm font-medium">
                    PIN
                  </label>
                  <Input id="pin" name="pin" maxLength={4} className="col-span-3" required />
                </div>
                {createState?.error && (
                  <p className="text-sm font-medium text-destructive text-center">
                    {createState.error}
                  </p>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating ? 'Creating...' : 'Create User'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
          <Badge variant="outline">Member Area</Badge>
        </div>
      </header>

      {state.phase === 'SUBMISSION' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">Weekly Selection</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              It's time to choose. Pick a movie that will define this week. Make it count.
            </p>
          </div>

          <div className="grid gap-8">
            {data.rejectedSubmission && (
              <Card className="w-full border-destructive/50 bg-destructive/10 relative overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                  <span className="text-9xl font-black text-destructive rotate-[-15deg]">REJECTED</span>
                </div>
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center justify-between">
                    <span>Proposal Rejected</span>
                    <Badge variant="destructive">Vetoed</Badge>
                  </CardTitle>
                  <CardDescription>Your previous choice was seen by the club. Choose another!</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                  {data.rejectedSubmission.coverUrl && (
                    <img src={data.rejectedSubmission.coverUrl} className="w-16 h-24 object-cover rounded shadow-sm opacity-50 grayscale" />
                  )}
                  <div>
                    <p className="font-bold text-lg line-through decoration-destructive">{data.rejectedSubmission.title}</p>
                    <p className="text-sm text-muted-foreground">Marked as seen during vetting.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!mySubmission ? (
              <Card className="w-full">
                <CardHeader>
                  <CardTitle>Your Proposal</CardTitle>
                  <CardDescription>Search for a movie to propose for this week.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <MovieSearch onSelect={handleMovieSelect} />

                  <Separator />

                  <form onSubmit={submitMovie} className="space-y-4">
                    <Input
                      placeholder="Movie Title..."
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      required
                    />
                    <Input
                      placeholder="Cover Image URL (Optional)..."
                      value={cover}
                      onChange={e => setCover(e.target.value)}
                    />
                    <Button className="w-full" disabled={submitting}>
                      {submitting ? 'Submitting...' : 'Lock In Choice'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <Card className="w-full border-primary/50 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-center">You have chosen wisely.</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <p className="text-3xl font-bold text-primary">{mySubmission.title}</p>
                  <p className="text-muted-foreground">Waiting for other members...</p>
                </CardContent>
              </Card>
            )}

            {data.queue && data.queue.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.queue.map((m: any) => (
                  <Card key={m.id} className={`overflow-hidden border-2 ${m.title === 'Mystery Movie' ? 'border-dashed border-muted-foreground/30 bg-muted/20' : 'border-primary/50 bg-primary/5'}`}>
                    <div className="aspect-[2/3] flex items-center justify-center bg-muted/10 relative">
                      {m.coverUrl ? (
                        <img src={m.coverUrl} className="object-cover w-full h-full" />
                      ) : (
                        <span className="text-4xl text-muted-foreground/20 font-bold">?</span>
                      )}
                    </div>
                    <CardContent className="p-3 text-center">
                      <p className="font-medium text-sm truncate">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{m.title === 'Mystery Movie' ? 'Locked' : 'Your Pick'}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between text-sm font-medium">
                  <span>Mission Status</span>
                  <span>{stats.submitted} / {stats.totalUsers} Ready</span>
                </div>
                <Progress value={(stats.submitted / stats.totalUsers) * 100} className="h-2" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {state.phase === 'ACTIVE' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          {/* Vetting Section */}
          {vettingMovie && (
            <Card className="border-primary/50">
              <CardHeader>
                <CardTitle>Movie Vetting - Week {state.week}</CardTitle>
                <CardDescription>Have you seen this movie before?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col md:flex-row gap-6">
                  {vettingMovie.coverUrl && (
                    <img
                      src={vettingMovie.coverUrl}
                      className="rounded-lg shadow-xl max-w-[200px]"
                      alt={vettingMovie.title}
                    />
                  )}
                  <div className="flex-1 space-y-4">
                    <h2 className="text-2xl font-bold">{vettingMovie.title}</h2>

                    {hasVetted ? (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground animate-pulse">
                          ✓ Your response has been recorded
                        </p>
                        {pendingVetters.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Waiting for:</p>
                            <div className="flex flex-wrap gap-2">
                              {pendingVetters.map((user: any) => (
                                <Badge key={user.id} variant="outline">{user.name}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Si no la has visto, continúa a votación. Si la has visto, se rechaza esta propuesta.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <Button variant="default" onClick={() => submitVetting(false)} className="h-16">
                            No la he visto
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => submitVetting(true)}
                            className="h-16 border-destructive text-destructive hover:bg-destructive/10"
                          >
                            Sí, la he visto
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          La opción Sí, la he visto marca la película como rechazada.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending Votes Section */}
          {pendingVotes.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Pending Votes</h2>
              <p className="text-muted-foreground">Rate these movies you've watched</p>

              {pendingVotes.map((movie: any) => (
                <Card key={movie.id}>
                  <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {movie.coverUrl && (
                        <img
                          src={movie.coverUrl}
                          className="rounded-lg shadow-xl max-w-[150px]"
                          alt={movie.title}
                        />
                      )}
                      <div className="flex-1 space-y-4">
                        <div>
                          <h3 className="text-xl font-bold">{movie.title}</h3>
                          <p className="text-sm text-muted-foreground">Week {movie.weekNumber}</p>
                        </div>

                        {movie.pendingUsers && movie.pendingUsers.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Still pending from:</p>
                            <div className="flex flex-wrap gap-2">
                              {movie.pendingUsers.map((user: any) => (
                                <Badge key={user.id} variant="outline">{user.name}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <Slider
                              defaultValue={[5]}
                              max={10}
                              step={1}
                              className="flex-1"
                              onValueChange={(value) => setRatings(prev => ({ ...prev, [movie.id]: value[0] }))}
                            />
                            <span className="text-lg font-bold min-w-[2ch] text-center">
                              {ratings[movie.id] ?? 5}
                            </span>
                          </div>
                          <Button
                            className="w-full"
                            onClick={() => submitVote(movie.id, ratings[movie.id] ?? 5)}
                          >
                            Submit Vote
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {votedVotes.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Votos enviados</h2>
              <p className="text-muted-foreground">Seguimiento de media y votos pendientes</p>

              {votedVotes.map((movie: any) => (
                <Card key={movie.id}>
                  <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {movie.coverUrl && (
                        <img
                          src={movie.coverUrl}
                          className="rounded-lg shadow-xl max-w-[150px]"
                          alt={movie.title}
                        />
                      )}
                      <div className="flex-1 space-y-4">
                        <div>
                          <h3 className="text-xl font-bold">{movie.title}</h3>
                          <p className="text-sm text-muted-foreground">Week {movie.weekNumber}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">Tu voto: {movie.myScore}</Badge>
                          <Badge variant="outline">Media actual: {movie.averageScore ?? '-'}</Badge>
                        </div>

                        {movie.pendingUsers && movie.pendingUsers.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Still pending from:</p>
                            <div className="flex flex-wrap gap-2">
                              {movie.pendingUsers.map((user: any) => (
                                <Badge key={user.id} variant="outline">{user.name}</Badge>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Todos han votado.</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!vettingMovie && pendingVotes.length === 0 && votedVotes.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <p>No pending actions. All caught up!</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {state.phase !== 'SUBMISSION' && state.phase !== 'ACTIVE' && (
        <div className="flex items-center justify-center min-h-[50vh]">
          <h1 className="text-2xl text-muted-foreground">Phase: {state.phase}</h1>
        </div>
      )}

      {/* History Section */}
      {data.history && data.history.length > 0 && (
        <div className="space-y-6 pt-12">
          <h2 className="text-2xl font-bold text-center">Hall of Fame</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.history.map((m: any) => (
              <Card key={m.id} className="overflow-hidden bg-muted/40 border-none hover:bg-muted/60 transition-colors">
                {m.coverUrl && (
                  <div className="aspect-[2/3] relative">
                    <img src={m.coverUrl} className="object-cover w-full h-full" />
                    {m.averageScore && (
                      <div className="absolute top-2 right-2">
                        <Badge variant="secondary" className="font-bold gap-1 shadow-lg bg-black/50 backdrop-blur text-white border-white/20">
                          ⭐ {m.averageScore}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}
                <CardContent className="p-4">
                  <h4 className="font-semibold line-clamp-1">{m.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">Week {m.weekNumber}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
