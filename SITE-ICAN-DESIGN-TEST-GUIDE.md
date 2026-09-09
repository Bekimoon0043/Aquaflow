# AquaFlow real-fountain design and music test

This build adds the site workflow under **Design > Pattern Designer > Site I-CAN**.
The studio creates editable absolute-state patterns for the recovered 64-valve
surface and runs them through the same gated I-CAN transport that already operated
the fountain.

## What is protected

- Group 2 is locked because the old database identifies a separate frequency controller.
- Group 25 is locked because the old database places rear/fire outputs in that range.
- Group 17 is either off or the exact captured support state that ran successfully.
- The importer omits the old pump, frequency, lighting, fire and valve 65-76 commands.
- Every stop, completed show, safety loss, disconnect or error ends with an all-group blackout.

## Prepare the fountain PC

1. Close the original Chinese I-CAN fountain application.
2. Connect the USB Ethernet adapter directly to the fountain network.
3. Set only that adapter to IPv4 `192.168.5.200`, mask `255.255.255.0`.
4. Leave its default gateway and DNS empty.
5. Open AquaFlow Studio.

## Open the hardware gates

1. Open **Operations > Fountain Control - I-CAN Gateway**.
2. Arm the global safety system. Confirm that the permit says **GRANTED**.
3. Connect manually to gateway `192.168.5.2`, gateway port `200`, local port `2002`.
4. Confirm the connection state is connected. A read-only verification response is useful,
   but output uses the already proven fire-and-forget gateway path.
5. Type `ARM OUTPUT` and click **ARM OUTPUT**.

Keep a person at the physical emergency stop and keep the basin clear during every first run.

## Create a pattern from a command

1. Open **Design > Pattern Designer > Site I-CAN**.
2. Enter a command such as `Create a slow center-out wave with a strong finale`.
3. Set seconds and BPM, or choose a style.
4. Click **Create editable draft**.
5. Inspect every step. Groups 2 and 25 must remain empty. Group 17 must show either zero
   channels or the seven captured support channels.
6. Give the draft a name and click **Save**.
7. For the first physical check, shorten it to 10-15 seconds and set Repeat to 1.
8. Type `RUN MANUAL PATTERN`, click **RUN MANUAL PATTERN**, and watch the fountain.
9. Click **STOP PATTERN** immediately if the physical result differs from the expected zone.

## Analyze music and create a dance

1. In the same Site I-CAN tab, choose a WAV file under **Automatic music choreography**.
2. Wait for the line showing duration, detected BPM and `pcm-wav`.
3. Correct the BPM field if the detector chose half-time or double-time.
4. Describe the desired movement in the prompt and click **Create dance from music**.
5. Save and inspect the generated steps.
6. Leave the same WAV selected. The editor shows `music: filename.wav` beside the run controls.
7. Type `RUN MANUAL PATTERN` and Run. AquaFlow starts the server-timed pattern and local audio
   together. Stop stops both immediately.

## Import and run the six old shows

1. Click **Import the 6 built-in programs** once. Re-importing updates the same six IDs and
   does not create duplicates.
2. Select one from the pattern list: `Legacy - music-1`, `music-3`, `music-4`, `music-5`,
   `music-6`, or `He's a Pirate`.
3. Choose the WAV with the matching filename in the music selector.
4. Inspect and save any edits.
5. For the first check, copy a small section into a new 10-15 second pattern. Run that short
   pattern first.
6. When the short check is correct, select the full imported pattern, keep Repeat at 1,
   type the run phrase, and start it.

The old application's proprietary action blobs are never executed. The importer preserves
the sample-frame section timing and translates named 76-valve effects into the commissioned
64-valve design surface. It is a safe structural reconstruction, so operators should review
and refine the converted motion in the step editor before treating it as the final artistic show.
