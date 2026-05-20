import fs from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import env from "@server/env";

interface SendMarkdownToChannelRequest {
  channel: string;
  title: string;
  contents: string[];
  rateLimitS: number;
}

interface SendMarkdownResponse {
  code: number;
  message: string;
}

interface NotificationServiceClient extends grpc.Client {
  SendMarkdownToChannel(
    request: SendMarkdownToChannelRequest,
    callback: grpc.requestCallback<SendMarkdownResponse>
  ): grpc.ClientUnaryCall;
}

interface NotificationGrpcClientOptions {
  channel: string;
  contents: string[];
  title: string;
}

type NotificationPackage = {
  notification: {
    v1: {
      NotificationService: typeof grpc.Client;
    };
  };
};

export default class NotificationGrpcClient {
  private client: NotificationServiceClient | undefined;

  /**
   * Send a markdown notification through notification-service.
   *
   * @param options the notification payload.
   * @returns a promise that resolves when the message has been sent.
   */
  public async sendMarkdownToChannel(options: NotificationGrpcClientOptions) {
    const target = env.NOTIFICATION_GRPC_TARGET;

    if (!target) {
      return;
    }

    const client = this.getClient(target);
    const response = await new Promise<SendMarkdownResponse>(
      (resolve, reject) => {
        client.SendMarkdownToChannel(
          {
            channel: options.channel,
            title: options.title,
            contents: options.contents,
            rateLimitS: env.NOTIFICATION_GRPC_RATE_LIMIT_SECONDS,
          },
          (err, res) => {
            if (err) {
              reject(err);
              return;
            }

            if (!res) {
              reject(new Error("Notification service returned no response"));
              return;
            }

            resolve(res);
          }
        );
      }
    );

    if (response.code !== 0) {
      throw new Error(response.message);
    }
  }

  private getClient(target: string) {
    if (this.client) {
      return this.client;
    }

    this.client = new this.service(target, this.credentials, {
      "grpc.default_authority": env.NOTIFICATION_GRPC_SERVER_NAME,
      "grpc.ssl_target_name_override": env.NOTIFICATION_GRPC_SERVER_NAME,
    }) as NotificationServiceClient;

    return this.client;
  }

  private get credentials() {
    if (
      !env.NOTIFICATION_GRPC_CA_CERT_PATH ||
      !env.NOTIFICATION_GRPC_CLIENT_CERT_PATH ||
      !env.NOTIFICATION_GRPC_CLIENT_KEY_PATH
    ) {
      throw new Error("Notification gRPC mTLS certificate paths are required");
    }

    return grpc.credentials.createSsl(
      fs.readFileSync(env.NOTIFICATION_GRPC_CA_CERT_PATH),
      fs.readFileSync(env.NOTIFICATION_GRPC_CLIENT_KEY_PATH),
      fs.readFileSync(env.NOTIFICATION_GRPC_CLIENT_CERT_PATH)
    );
  }

  private get service() {
    const protoPath = path.join(__dirname, "../protos/notification.proto");
    const packageDefinition = protoLoader.loadSync(protoPath, {
      defaults: true,
      keepCase: false,
      longs: Number,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(
      packageDefinition
    ) as unknown as NotificationPackage;

    return proto.notification.v1.NotificationService;
  }
}
