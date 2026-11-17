---
name: spot
description: Control the user's Spotify with the `spot` CLI. Use for any request about music - play a song, album or artist, "DJ for me", make or change a playlist, what is playing, skip, pause, volume.
---

# spot

`spot` is the hands. You are the brain. Spotify gives no song suggestions, so you select songs from your own music knowledge, and `spot` finds them and plays them.

Each command prints one JSON object. `ok` is the result. On `ok: false`, read `error.code` and do what `error.hint` says.

## Play something now

```bash
spot play "fear nf"                         # a song
spot play "discovery daft punk" --type album
spot play "daft punk" --type artist
spot play "morning coffee" --type playlist  # add --mine for one of the user's own playlists
spot play "nf the search" --queue           # plays next, the current song continues
spot now                                    # what plays, on which device
```

## Learn the user's taste

`spot` keeps a memory of the user's taste in plain files. You do not need your own memory for music. Use these commands:

```bash
spot taste profile        # READ THIS FIRST before you select songs: notes, bans, loves, favourites, skips, situations, score
spot feel love            # the user likes the song that plays now. Also: meh (less often), ban (never), clear (forget)
spot feel ban "Artist - Title" --why "their words"
spot feel ban --artist "Artist - Title"     # all songs by the artist
spot taste note "Skips songs over 6 minutes when working"            # one lesson
spot taste note --section "Situations" "Gym: fast hip-hop, no ballads"
spot taste score          # skip rate of your songs, each week. It must go down.
```

Rules:

- When the user says anything about a song or an artist ("love this", "never again", "too slow"), record it at once with `spot feel`. Put their words in `--why`.
- Bans are enforced by `spot`: sets and playlists leave banned songs out and list them in `blocked`. Use `--include-banned` only when the user asks for that song.
- `notes.text` in the profile is the user's taste file. "Rules you said" are the user's words: always follow them, and change them only when the user asks. "Agent notes (not confirmed)" are guesses.
- Write a lesson only when the data shows it (several skips, not one). Each lesson is one line in plain words.
- About 1 song in 5 must be new to the user. Without new songs, you learn nothing more. `score.dj.newSongs` and `score.dj.knownSongs` show how each kind does.

The record of plays comes from the watcher. `spot watch status` shows if it runs. If it does not run, on macOS: `spot watch install`. Years of old plays: unzip the user's Spotify data download, then `spot history import <folder>`.

Weekly review (when asked, or on a schedule): read `spot taste profile` and `spot taste score`. Then edit the notes file (`notes.path`): join notes that say the same thing, move guesses that the data now supports to "Situations", and delete guesses that the data contradicts. Keep the file short: under 60 lines.

## DJ a set

A set is an ordered list of songs. One command starts it, and it then plays with no help from you.

1. Read the taste: `spot taste profile`. Use the situation that fits now (time of day, device). If the profile has little data, also read `spot taste` (live data from Spotify). Done when you can name artists and songs that the user likes here and now.
2. Select 25 to 40 songs that fit the request. Mix known favourites with songs that are new to the user (about 1 in 5). Write one song for each line as `Artist - Title`.
3. Start the set:

   ```bash
   spot dj start --name "Deep focus" --note "calm, no vocals" --from - <<'EOF'
   Tycho - Awake
   Bonobo - Kerala
   EOF
   ```

   Done when the reply has `ok: true`. `missed` lists songs that Spotify did not find: the name was wrong, or the song is not real. `blocked` lists songs that the user banned. Tell the user what plays.
4. Read the room: `spot dj status`. `skipped` lists the songs that the user did not want.
5. Change direction: `spot dj steer --from -` with new songs. The current song continues. The songs after it are replaced. Do this after skips, or when the user asks for a change.
6. End: `spot dj stop` gives the final report. Then write 1 to 3 lessons with `spot taste note`, for example "Focus set: lo-fi house kept, jazz skipped 4 of 5".

## Playlists

```bash
spot playlist create "Road trip" --description "Windows down" --from songs.txt   # add --play to start it
spot playlist list
spot playlist show "Road trip"
spot playlist add "Road trip" "Artist - Title" "Artist - Title"
spot playlist replace "Road trip" --from -
spot playlist remove "Road trip" spotify:track:...
spot playlist update "Road trip" --name "Road trip 2"
```

A new playlist is private. Add `--public` only when the user asks.
The playlist argument is the name of one of the user's playlists, an id, a URI or a link.
`spot resolve --from -` checks a list of song names and changes nothing on the account.

## Devices

Music plays in a Spotify app, not in the terminal. On `NO_ACTIVE_DEVICE`, read `error.devices`:

- Two or more devices: select one with `--device "<name>"`. Ask the user where they listen if you cannot tell.
- No devices: Spotify is closed on all devices. `--wake` opens Spotify on this computer, and the sound then comes from this computer. Use `--wake` when the user is at this computer. If not, ask the user to open Spotify on their phone.

## Errors

| `error.code` | What to do |
| --- | --- |
| `NOT_LOGGED_IN`, `AUTH_EXPIRED`, `SCOPE_MISSING` | Stop. Ask the user to run `spot auth login`. The login needs a browser and a person. |
| `PREMIUM_REQUIRED` | Stop. Give the user the text of `error.message`. |
| `RATE_LIMITED`, `QUOTA_EXCEEDED` | Wait for `error.retryAfterSeconds`, then continue. |
| `NOT_FOUND` | Try different words. |
| `BAD_INPUT` | Correct the command. `spot <command> --help` shows the options. |

## More

`spot --help` lists all commands: search, recent, devices, pause, next, volume, queue, library.
