import { Status } from "../../../../constants/Project";
import { ErrorCode } from "../../../../ErrorCode";
import { CloudStorageFilesDAO, CloudStorageUserFilesDAO } from "../../../../dao";
import { FastifySchema, Response, ResponseError } from "../../../../types/Server";
import { whiteboardQueryConversionTask } from "../../../utils/request/whiteboard/WhiteboardRequest";
import { FileConvertStep } from "../../../../model/cloudStorage/Constants";
import { determineType, isConvertDone, isConvertFailed } from "./Utils";
import { AbstractController } from "../../../../abstract/controller";
import { Controller } from "../../../../decorator/Controller";

@Controller<RequestType, ResponseType>({
    method: "post",
    path: "cloud-storage/convert/finish",
    auth: true,
})
export class FileConvertFinish extends AbstractController<RequestType, ResponseType> {
    public static readonly schema: FastifySchema<RequestType> = {
        body: {
            type: "object",
            required: ["fileUUID"],
            properties: {
                fileUUID: {
                    type: "string",
                    format: "uuid-v4",
                },
            },
        },
    };

    public async execute(): Promise<Response<ResponseType>> {
        const { fileUUID } = this.body;
        const userUUID = this.userUUID;

        const userFileInfo = await CloudStorageUserFilesDAO().findOne(["id"], {
            file_uuid: fileUUID,
            user_uuid: userUUID,
        });

        if (userFileInfo === undefined) {
            return {
                status: Status.Failed,
                code: ErrorCode.FileNotFound,
            };
        }

        const fileInfo = await CloudStorageFilesDAO().findOne(
            ["file_url", "convert_step", "task_uuid", "region"],
            {
                file_uuid: fileUUID,
            },
        );

        if (fileInfo === undefined) {
            return {
                status: Status.Failed,
                code: ErrorCode.FileNotFound,
            };
        }

        const { file_url: resource, convert_step, task_uuid, region } = fileInfo;

        if (isConvertDone(convert_step)) {
            return {
                status: Status.Failed,
                code: ErrorCode.FileIsConverted,
            };
        }

        if (isConvertFailed(convert_step)) {
            return {
                status: Status.Failed,
                code: ErrorCode.FileConvertFailed,
            };
        }

        const resourceType = determineType(resource);
        const result = await whiteboardQueryConversionTask(region, task_uuid, resourceType);
        const convertStatus = result.data.status;

        switch (convertStatus) {
            case "Finished": {
                await CloudStorageFilesDAO().update(
                    {
                        convert_step: FileConvertStep.Done,
                    },
                    {
                        file_uuid: fileUUID,
                    },
                );

                return {
                    status: Status.Success,
                    data: {},
                };
            }
            case "Fail": {
                await CloudStorageFilesDAO().update(
                    {
                        convert_step: FileConvertStep.Failed,
                    },
                    {
                        file_uuid: fileUUID,
                    },
                );

                return {
                    status: Status.Failed,
                    code: ErrorCode.FileConvertFailed,
                };
            }
            default: {
                return {
                    status: Status.Failed,
                    code:
                        convertStatus === "Waiting"
                            ? ErrorCode.FileIsConvertWaiting
                            : ErrorCode.FileIsConverting,
                };
            }
        }
    }

    public errorHandler(error: Error): ResponseError {
        return this.autoHandlerError(error);
    }
}

interface RequestType {
    body: {
        fileUUID: string;
    };
}

interface ResponseType {}
