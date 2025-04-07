import "./App.css";

import ReactMarkdown from "react-markdown";
import SendIcon from "@material-ui/icons/Send";
import React, { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Grid,
  Paper,
  TextField,
  Typography,
} from "@material-ui/core";
import {
  KeyHelper,
  MessageType,
  PreKeyType,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  SignedPublicPreKeyType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { makeStyles } from "@material-ui/core/styles";

import CodeBlock from "./code-block";
import { SignalDirectory } from "./signal-directory";
import { SignalProtocolStore } from "./storage-type";

const initialStory =
  "# Start using the demo to see what is happening in the code";
const createidMD = "createid.md";
const startSessionWithAMD = "start-session-with-a.md";
const startSessionWithBMD = "start-session-with-b.md";
const sendMessageMD = "send-message.md";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
  },
  paper: {
    padding: theme.spacing(2),
    margin: "auto",
    maxWidth: "90%",
  },
  image: {
    width: 128,
    height: 128,
  },
  container: {
    padding: theme.spacing(2),
  },
  buttonitem: {
    margin: 10,
    padding: 10,
  },
  message: {
    padding: 10,
    backgroundColor: "lightsteelblue",
    margin: 10,
    maxWidth: "90%",
    textAlign: "left",
  },
  outgoingmessage: {
    padding: 10,
    backgroundColor: "linen",
    margin: 10,
    maxWidth: "90%",
  },
  img: {
    margin: "auto",
    display: "block",
    maxWidth: "100%",
    maxHeight: "100%",
  },
  story: {
    margin: "auto",
    display: "block",
    textAlign: "left",
    fontSize: "10pt",
  },
}));

interface ChatMessage {
  id: number;
  to: string;
  from: string;
  message: MessageType;
  delivered: boolean;
}
interface ProcessedChatMessage {
  id: number;
  to: string;
  from: string;
  messageText: string;
}
let msgID = 0;

function getNewMessageID(): number {
  return msgID++;
}

// define addresses

const duvanAddress = new SignalProtocolAddress("duvan", 1);
const sebastianAddress = new SignalProtocolAddress("sebastian", 1);

function App() {
  const [adiStore] = useState(new SignalProtocolStore());
  const [sebastianStore] = useState(new SignalProtocolStore());

  const [aHasIdentity, setAHasIdentity] = useState(false);
  const [bHasIdentity, setBHasIdentity] = useState(false);

  const [directory] = useState(new SignalDirectory());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [processedMessages, setProcessedMessages] = useState<
    ProcessedChatMessage[]
  >([]);

  const [hasSession, setHasSession] = useState(false);

  const [duvanTyping, setDuvanidTyping] = useState("");
  const [sebastianTyping, setSebastianTyping] = useState("");

  const [processing, setProcessing] = useState(false);
  const [story, setStory] = useState(initialStory);


  const classes = useStyles();

  const updateStory = async (url: string) => {
    const resp = await fetch(url);
    const md = await resp.text();
    setStory(md);
  };

  const sendMessage = (to: string, from: string, message: MessageType) => {
    const msg = { to, from, message, delivered: false, id: getNewMessageID() };
    setMessages([...messages, msg]);
  };

  useEffect(() => {
    if (!messages.find((m) => !m.delivered) || processing) {
      return;
    }

    const getReceivingSessionCipherForRecipient = (to: string) => {
      // send from Sebastian to Duvan so use his store
      const store = to === "sebastian" ? sebastianStore : adiStore;
      const address = to === "sebastian" ? duvanAddress : sebastianAddress;
      return new SessionCipher(store, address);
    };

    const doProcessing = async () => {
      while (messages.length > 0) {
        const nextMsg = messages.shift();
        if (!nextMsg) {
          continue;
        }
        const cipher = getReceivingSessionCipherForRecipient(nextMsg.to);
        const processed = await readMessage(nextMsg, cipher);
        processedMessages.push(processed);
      }
      setMessages([...messages]);
      setProcessedMessages([...processedMessages]);
    };
    setProcessing(true);
    doProcessing().then(() => {
      setProcessing(false);
    });
  }, [adiStore, sebastianStore, messages, processedMessages, processing]);

  const readMessage = async (msg: ChatMessage, cipher: SessionCipher) => {
    let plaintext: ArrayBuffer = new Uint8Array().buffer;

    if (msg.message.type === 3) {
      plaintext = await cipher.decryptPreKeyWhisperMessage(
        msg.message.body!,
        "binary"
      );
      setHasSession(true);
    } else if (msg.message.type === 1) {
      plaintext = await cipher.decryptWhisperMessage(
        msg.message.body!,
        "binary"
      );
    }
    const stringPlaintext = new TextDecoder().decode(new Uint8Array(plaintext));
    console.log(`readMessage from ${msg.from} to ${msg.to} type ${msg.message.type} body ${new TextEncoder().encode(msg.message.body!)} ${stringPlaintext}`);

    const { id, to, from } = msg;
    return { id, to, from, messageText: stringPlaintext };
  };

  const storeSomewhereSafe = (store: SignalProtocolStore) => (
    key: string,
    value: any
  ) => {
    store.put(key, value);
  };

  const createID = async (name: string, store: SignalProtocolStore) => {
    const registrationId = KeyHelper.generateRegistrationId();
    // Store registrationId somewhere durable and safe... Or do this.
    storeSomewhereSafe(store)(`registrationID`, registrationId);

    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    // Store identityKeyPair somewhere durable and safe... Or do this.
    storeSomewhereSafe(store)("identityKey", identityKeyPair);

    const baseKeyId = Math.floor(10000 * Math.random());
    const preKey = await KeyHelper.generatePreKey(baseKeyId);
    store.storePreKey(`${baseKeyId}`, preKey.keyPair);

    const signedPreKeyId = Math.floor(10000 * Math.random());
    const signedPreKey = await KeyHelper.generateSignedPreKey(
      identityKeyPair,
      signedPreKeyId
    );
    store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);
    const publicSignedPreKey: SignedPublicPreKeyType = {
      keyId: signedPreKeyId,
      publicKey: signedPreKey.keyPair.pubKey,
      signature: signedPreKey.signature,
    };

    // Now we register this with the server so all users can see them
    const publicPreKey: PreKeyType = {
      keyId: preKey.keyId,
      publicKey: preKey.keyPair.pubKey,
    };
    directory.storeKeyBundle(name, {
      registrationId,
      identityPubKey: identityKeyPair.pubKey,
      signedPreKey: publicSignedPreKey,
      oneTimePreKeys: [publicPreKey],
    });
    updateStory(createidMD);
  };

  const createDuvanidIdentity = async () => {
    await createID("duvan", adiStore);
    console.log({ adiStore });
    setAHasIdentity(true);
  };

  const createSebastianIdentity = async () => {
    await createID("sebastian", sebastianStore);
    setBHasIdentity(true);
  };

  // const starterMessageBytes = Uint8Array.from([
  //   0xce,
  //   0x93,
  //   0xce,
  //   0xb5,
  //   0xce,
  //   0xb9,
  //   0xce,
  //   0xac,
  //   0x20,
  //   0xcf,
  //   0x83,
  //   0xce,
  //   0xbf,
  //   0xcf,
  //   0x85,
  // ]);

  // "Foo"
  const starterMessageBytes = Uint8Array.from([70, 111, 111])
  // const starterMessageBytes = Uint8Array.from([0,0, 0, 0])

  const startSessionWithSebastian = async () => {
    // get Sebastian' key bundle
    const sebastianBundle = directory.getPreKeyBundle("sebastian");
    console.log({ sebastianBundle });

    const recipientAddress = sebastianAddress;

    // Instantiate a SessionBuilder for a remote recipientId + deviceId tuple.
    const sessionBuilder = new SessionBuilder(adiStore, recipientAddress);

    // Process a prekey fetched from the server. Returns a promise that resolves
    // once a session is created and saved in the store, or rejects if the
    // identityKey differs from a previously seen identity for this address.
    console.log("duvan processing prekey");
    await sessionBuilder.processPreKey(sebastianBundle!);

    // // Now we can send an encrypted message
    // const duvanSessionCipher = new SessionCipher(adiStore, recipientAddress);
    // const ciphertext = await duvanSessionCipher.encrypt(
    //   starterMessageBytes.buffer
    // );

    // sendMessage("sebastian", "duvan", ciphertext);
    updateStory(startSessionWithBMD);
    setHasSession(true);
  };

  const startSessionWithDuvanid = async () => {
    // get Duvan's key bundle
    const duvanBundle = directory.getPreKeyBundle("duvan");
    console.log({ duvanBundle });

    const recipientAddress = duvanAddress;

    // Instantiate a SessionBuilder for a remote recipientId + deviceId tuple.
    const sessionBuilder = new SessionBuilder(sebastianStore, recipientAddress);

    // Process a prekey fetched from the server. Returns a promise that resolves
    // once a session is created and saved in the store, or rejects if the
    // identityKey differs from a previously seen identity for this address.
    console.log("sebastian processing prekey");
    await sessionBuilder.processPreKey(duvanBundle!);

    // // Now we can send an encrypted message
    // const sebastianSessionCipher = new SessionCipher(
    //   sebastianStore,
    //   recipientAddress
    // );
    // const ciphertext = await sebastianSessionCipher.encrypt(
    //   starterMessageBytes.buffer
    // );

    // sendMessage("duvan", "sebastian", ciphertext);
    updateStory(startSessionWithAMD);
    setHasSession(true);
  };

  const displayMessages = (sender: string) => {
    return processedMessages.map((m, index) => (
      <React.Fragment>
        {m.from === sender ? <Grid xs={2} item /> : <div />}
        <Grid xs={10} item key={`${m.id}-${index}`}>
          <Paper
            className={
              m.from === sender ? classes.outgoingmessage : classes.message
            }
          >
            <Typography variant="body1">{m.messageText}</Typography>
          </Paper>
        </Grid>
        {m.from !== sender ? <Grid xs={2} item /> : <div />}
      </React.Fragment>
    ));
  };

  const getSessionCipherForRecipient = (to: string) => {
    // send from Sebastian to duvan so use his store
    const store = to === "duvan" ? sebastianStore : adiStore;
    const address = to === "duvan" ? duvanAddress : sebastianAddress;
    return new SessionCipher(store, address);
  };

  const encryptAndSendMessage = async (to: string, message: string) => {
    const cipher = getSessionCipherForRecipient(to);
    const from = to === "duvan" ? "sebastian" : "duvan";
    const ciphertext = await cipher.encrypt(
      new TextEncoder().encode(message).buffer
    );
    if (from === "duvan") {
      setDuvanidTyping("");
    } else {
      setSebastianTyping("");
    }
    sendMessage(to, from, ciphertext);
    updateStory(sendMessageMD);

    // try {
    //   const copy = ciphertext.body!.slice(0, ciphertext.body!.length);

    //   const cipher2 = getSessionCipherForRecipient(from);

    //   const unencrypted = await cipher2.decryptPreKeyWhisperMessage(
    //     copy,
    //     "binary"
    //     );
    //   const unencryptedString = new TextDecoder().decode(new Uint8Array(unencrypted));
    //   console.log(`unencrypted: ${unencryptedString} ${to}`);
    // } catch (e) {
    //   console.log(`error: ${e}`);
    // }
  };

  const sendMessageControl = (to: string) => {
    const value = to === "duvan" ? sebastianTyping : duvanTyping;
    const onTextChange =
      to === "duvan" ? setSebastianTyping : setDuvanidTyping;
    return (
      <Grid item xs={12} key="input">
        <Paper className={classes.paper}>
          <TextField
            id="outlined-multiline-static"
            label={`Message ${to}`}
            multiline
            value={value}
            onChange={(event) => {
              onTextChange(event.target.value);
            }}
            variant="outlined"
          ></TextField>
          <Button
            onClick={() => encryptAndSendMessage(to, value)}
            variant="contained"
            className={classes.buttonitem}
          >
            {" "}
            <SendIcon />
          </Button>
        </Paper>
      </Grid>
    );
  };

  return (
    <div className="App">
      <Paper className={classes.paper}>
        <Grid container spacing={2} className={classes.container}>
          <Grid item xs={3}>
            <Paper className={classes.paper}>
              <Grid container>
                <Grid item xs={9}>
                  <Typography
                    variant="h5"
                    style={{ textAlign: "right", verticalAlign: "top" }}
                    gutterBottom
                  >
                    Duvan's View
                  </Typography>
                </Grid>
                <Grid item xs={1}></Grid>
                <Grid item xs={2}>
                  <Avatar>A</Avatar>
                </Grid>
                <Grid item xs={12}>
                  {aHasIdentity ? (
                    <React.Fragment>
                      <Chip
                        label={`Duvan Registration ID: ${adiStore.get(
                          "registrationID",
                          ""
                        )}`}
                      ></Chip>
                      {hasSession || !(aHasIdentity && bHasIdentity) ? (
                        <div />
                      ) : (
                        <Button
                          className={classes.buttonitem}
                          variant="contained"
                          onClick={startSessionWithSebastian}
                        >
                          Start session with Sebastian
                        </Button>
                      )}
                    </React.Fragment>
                  ) : (
                    <Button
                      className={classes.buttonitem}
                      variant="contained"
                      onClick={createDuvanidIdentity}
                    >
                      Create an identity for Duvan
                    </Button>
                  )}
                </Grid>
                {hasSession ? sendMessageControl("sebastian") : <div />}
                {displayMessages("duvan")}
              </Grid>
            </Paper>
          </Grid>
          <Grid item xs={6}>
            <Paper className={classes.paper}>
              <Typography variant="h3" component="h3" gutterBottom>
                Duvan talks to Sebastian
              </Typography>
              <ReactMarkdown
                children={story}
                className={classes.story}
                // @ts-ignore
                components={ CodeBlock }
              ></ReactMarkdown>
            </Paper>
          </Grid>
          <Grid item xs={3}>
            <Paper className={classes.paper}>
              <Grid container>
                <Grid item xs={2}>
                  <Avatar>B</Avatar>
                </Grid>
                <Grid item xs={10}>
                  <Typography
                    variant="h5"
                    style={{ textAlign: "left", verticalAlign: "top" }}
                    gutterBottom
                  >
                    Sebastian's View
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  {bHasIdentity ? (
                    <React.Fragment>
                      <Chip
                        label={`Sebastian's Registration ID: ${sebastianStore.get(
                          "registrationID",
                          ""
                        )}`}
                      ></Chip>
                      {hasSession || !(aHasIdentity && bHasIdentity) ? (
                        <div />
                      ) : (
                        <Button
                          className={classes.buttonitem}
                          variant="contained"
                          onClick={startSessionWithDuvanid}
                        >
                          Start session with Duvan
                        </Button>
                      )}
                    </React.Fragment>
                  ) : (
                    <Button
                      variant="contained"
                      onClick={createSebastianIdentity}
                    >
                      Create an identity for Sebastian
                    </Button>
                  )}
                </Grid>
                {hasSession ? sendMessageControl("duvan") : <div />}
                {displayMessages("sebastian")}
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      </Paper>
    </div>
  );
}

export default App;
