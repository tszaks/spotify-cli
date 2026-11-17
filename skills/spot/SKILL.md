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

## DJ a set

A set is an ordered list of songs. One command starts it, and it then plays with no help from you.

1. Read the taste: `spot taste`. Done when you can name artists and songs that the user likes.
2. Select 25 to 40 songs that fit the request. Mix known favourites with songs that are new to the user. Write one song for each line as `Artist - Title`.
3. Start the set:

   ```bash
   spot dj start --name "Deep focus" --note "calm, no vocals" --from - <<'EOF'
   Tycho - Awake
   Bonobo - Kerala
   EOF
   ```

   Done when the reply has `ok: true`. `missed` lists songs that Spotify did not find: the name was wrong, or the song is not real. Tell the user what plays.
4. Read the room: `spot dj status`. `skipped` lists the songs that the user did not want.
5. Change direction: `spot dj steer --from -` with new songs. The current song continues. The songs after it are replaced. Do this after skips, or when the user asks for a change.
6. End: `spot dj stop` gives the final report. Keep what was skipped in your memory for the next set.

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
